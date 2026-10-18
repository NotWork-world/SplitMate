import {AppState, Linking, NativeModules, Share} from 'react-native';

export type PickedContact = {name: string; phone: string};

/** The phone's own contact picker (android ContactPicker.kt). Null if the person backs out. */
export async function pickContact(): Promise<PickedContact | null> {
  const mod = NativeModules.ContactPicker;
  if (!mod) {
    throw new Error('Picking contacts isn’t available on this phone.');
  }
  const c = await mod.pick();
  // The result arrives before Android resumes the app; views mounted while paused can
  // miss their first animated frame, so hand it over once SplitMate is in front again.
  await untilActive();
  return c ? {name: String(c.name ?? '').trim(), phone: String(c.phone ?? '')} : null;
}

function untilActive(): Promise<void> {
  if (AppState.currentState === 'active') {
    return new Promise(r => requestAnimationFrame(() => r()));
  }
  return new Promise(resolve => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        sub.remove();
        requestAnimationFrame(() => resolve());
      }
    });
  });
}

/**
 * Phone number in the international digits-only form WhatsApp wants (919876543210).
 * Local Indian numbers (98765 43210, 098765…) get +91; anything with a + keeps its code.
 */
export function normalizePhone(raw: string, defaultCountry = '91'): string | null {
  const plus = raw.trim().startsWith('+') || raw.trim().startsWith('00');
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('00')) {
    d = d.slice(2);
  }
  if (!plus) {
    d = d.replace(/^0+/, '');
    if (d.length === 10) {
      d = defaultCountry + d;
    }
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function usernameError(u: string): string | null {
  const v = u.trim().replace(/^@/, '').toLowerCase();
  if (!v) {
    return null;
  }
  return /^[a-z0-9](?:[a-z0-9_.]{1,18})[a-z0-9]$/.test(v) ? null : 'Use 3–20 letters, numbers, _ or .';
}

/** Opens WhatsApp on a chat with this number and the message typed in; falls back to the share sheet. */
export async function sendOnWhatsApp(phone: string | null, text: string): Promise<'whatsapp' | 'share'> {
  const msg = encodeURIComponent(text);
  const urls = phone
    ? [`whatsapp://send?phone=${phone}&text=${msg}`, `https://wa.me/${phone}?text=${msg}`]
    : [`whatsapp://send?text=${msg}`];
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return 'whatsapp';
    } catch {
      // try the next way
    }
  }
  await Share.share({message: text});
  return 'share';
}
