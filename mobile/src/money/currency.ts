// Currency metadata and display. Amounts are integers in the minor unit.

export interface Currency {
  code: string;
  exponent: number;
  symbol: string;
  indian?: boolean; // lakh/crore digit grouping
}

const LIST: Currency[] = [
  {code: 'INR', exponent: 2, symbol: '₹', indian: true},
  {code: 'USD', exponent: 2, symbol: '$'},
  {code: 'EUR', exponent: 2, symbol: '€'},
  {code: 'GBP', exponent: 2, symbol: '£'},
  {code: 'AED', exponent: 2, symbol: 'AED '},
  {code: 'SGD', exponent: 2, symbol: 'S$'},
  {code: 'AUD', exponent: 2, symbol: 'A$'},
  {code: 'CAD', exponent: 2, symbol: 'C$'},
  {code: 'NPR', exponent: 2, symbol: 'Rs '},
  {code: 'LKR', exponent: 2, symbol: 'Rs '},
  {code: 'BDT', exponent: 2, symbol: '৳'},
  {code: 'THB', exponent: 2, symbol: '฿'},
  {code: 'MYR', exponent: 2, symbol: 'RM '},
  {code: 'JPY', exponent: 0, symbol: '¥'},
  {code: 'KRW', exponent: 0, symbol: '₩'},
  {code: 'KWD', exponent: 3, symbol: 'KD '},
  {code: 'BHD', exponent: 3, symbol: 'BD '},
  {code: 'OMR', exponent: 3, symbol: 'OMR '},
];

const BY_CODE: Record<string, Currency> = Object.fromEntries(LIST.map(c => [c.code, c]));

export const SUPPORTED_CURRENCIES = LIST.map(c => c.code);

export function getCurrency(code: string): Currency | undefined {
  return BY_CODE[code.toUpperCase()];
}

export function factor(code: string): number {
  return 10 ** (getCurrency(code)?.exponent ?? 2);
}

function group(whole: string, indian: boolean): string {
  if (whole.length <= 3) {
    return whole;
  }
  const last3 = whole.slice(-3);
  let rest = whole.slice(0, -3);
  const size = indian ? 2 : 3;
  const parts: string[] = [];
  while (rest.length > size) {
    parts.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  if (rest) {
    parts.unshift(rest);
  }
  return `${parts.join(',')},${last3}`;
}

/** ₹1,250.50 · ₹12,50,000.00 · ¥1,001 · KD 12.345 — always the currency's full precision. */
export function formatMoney(minor: number, code: string, opts: {sign?: boolean} = {}): string {
  const cur = getCurrency(code) ?? {code, exponent: 2, symbol: `${code} `};
  const f = 10 ** cur.exponent;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / f).toString();
  const frac = cur.exponent ? '.' + (abs % f).toString().padStart(cur.exponent, '0') : '';
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${cur.symbol}${group(whole, !!cur.indian)}${frac}`;
}

/**
 * Parse what a person typed ("1,250.5", "₹ 99") into minor units without floats.
 * Returns null when it isn't a valid amount for the currency's precision.
 */
export function parseMoney(text: string, code: string): number | null {
  const exp = getCurrency(code)?.exponent ?? 2;
  const cleaned = text.replace(/[^\d.]/g, '');
  if (!cleaned || cleaned === '.') {
    return null;
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) {
    return null;
  }
  const [, w = '', fr = ''] = m;
  if (fr.length > exp) {
    return null;
  }
  const whole = w === '' ? 0 : Number(w);
  const frac = exp ? Number((fr + '0'.repeat(exp)).slice(0, exp)) : 0;
  const v = whole * 10 ** exp + frac;
  return Number.isSafeInteger(v) ? v : null;
}

/** Minor units -> editable text ("1250.50"), no grouping. */
export function toInputText(minor: number, code: string): string {
  const exp = getCurrency(code)?.exponent ?? 2;
  if (!exp) {
    return String(minor);
  }
  const f = 10 ** exp;
  return `${Math.floor(Math.abs(minor) / f)}.${(Math.abs(minor) % f).toString().padStart(exp, '0')}`;
}

/** 500 -> "5%", 250 -> "2.5%", 1250 -> "12.5%". */
export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (!frac) {
    return `${whole}%`;
  }
  return `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}%`;
}

/** "2.5" -> 250 basis points; null if invalid or more than two decimals. */
export function parseBp(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim().replace('%', ''));
  if (!m) {
    return null;
  }
  const v = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  return v <= 10000 ? v : null;
}

/** Quantity in thousandths -> "1", "1.5", "0.25". */
export function formatQty(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = milli % 1000;
  return frac ? `${whole}.${frac.toString().padStart(3, '0').replace(/0+$/, '')}` : `${whole}`;
}

export function parseQty(text: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{0,3}))?$/.exec(text.trim());
  if (!m) {
    return null;
  }
  const v = Number(m[1]) * 1000 + Number(((m[2] ?? '') + '000').slice(0, 3));
  return v > 0 ? v : null;
}
