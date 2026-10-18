import {Linking} from 'react-native';

export const UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/;

/** UPI apps we can open straight on the "pay" screen. `generic` lets Android choose. */
export const UPI_APPS = [
  {key: 'gpay', label: 'Google Pay', base: 'tez://upi/pay'},
  {key: 'phonepe', label: 'PhonePe', base: 'phonepe://pay'},
  {key: 'paytm', label: 'Paytm', base: 'paytmmp://pay'},
  {key: 'generic', label: 'Other UPI app', base: 'upi://pay'},
] as const;
export type UpiAppKey = (typeof UPI_APPS)[number]['key'];

/**
 * A UPI pay link. The amount is left out on purpose unless given: the payer types it
 * in their own app, so SplitMate never pre-commits money on their behalf.
 */
export function upiPayUrl(base: string, p: {upiId: string; name: string; note?: string; amount?: string}): string {
  const q = [`pa=${encodeURIComponent(p.upiId)}`, `pn=${encodeURIComponent(p.name)}`, 'cu=INR'];
  if (p.amount) {
    q.push(`am=${p.amount}`);
  }
  if (p.note) {
    q.push(`tn=${encodeURIComponent(p.note.slice(0, 50))}`);
  }
  return `${base}?${q.join('&')}`;
}

/** Reads the payee out of a UPI QR (`upi://pay?pa=…&pn=…`). Returns null for anything else. */
export function parseUpiQr(text: string): {upiId: string; name: string | null} | null {
  const m = /^upi:\/\/pay\?(.*)$/i.exec(text.trim());
  if (!m) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const part of m[1].split('&')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        params[part.slice(0, i).toLowerCase()] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
      } catch {
        // malformed escape: skip this parameter
      }
    }
  }
  const upiId = params.pa?.trim();
  if (!upiId || !UPI_ID_RE.test(upiId)) {
    return null;
  }
  return {upiId, name: params.pn?.trim() || null};
}

/** Which of the listed apps are installed (the generic chooser counts if any UPI app is). */
export async function installedUpiApps(): Promise<Set<UpiAppKey>> {
  const found = new Set<UpiAppKey>();
  await Promise.all(
    UPI_APPS.map(async a => {
      try {
        if (await Linking.canOpenURL(`${a.base}?pa=test@upi`)) {
          found.add(a.key);
        }
      } catch {
        // treat as not installed
      }
    }),
  );
  return found;
}
