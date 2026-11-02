// SplitMate bill engine — TypeScript port of server/app/money/engine.py.
// The phone uses it for instant previews; the server recomputes on finalisation.
// Both must pass shared/fixtures/bills.json. Keep the order of operations and
// every rounding step identical to the Python version (see its module docstring).

import {allocate, allocateEqual, divRoundHalfUp, mulDivRoundHalfUp} from './allocate';
import {factor, formatMoney, getCurrency} from './currency';
import type {
  BillInput,
  BillResult,
  ChargeIn,
  ChargeResult,
  DiscountResult,
  Issue,
  ItemIn,
  ItemResult,
  ItemShare,
  PersonResult,
  ReportedTaxIn,
  TaxLine,
} from './types';

export const ENGINE_VERSION = 1;
const BP = 10_000;
const SPLIT_MODES = ['equal', 'shares', 'percent', 'exact'];
const TAX_SCHEMES = ['gst', 'cgst_sgst', 'igst'];
const KINDS = ['fixed', 'percent'];
const STAGES = ['pre_tax', 'post_tax'];
const ALLOCATIONS = ['proportional', 'equal'];
const CHARGE_TYPES = ['service', 'packaging', 'delivery', 'tip', 'other', 'adjustment'];
const ROUNDING_MODES = ['none', 'explicit', 'nearest_unit'];
const TAX_COMPONENTS = ['GST', 'CGST', 'SGST', 'IGST'];

type Comp = [string, number, number]; // component, component rate, amount
type GroupKey = string; // `${rate}|${scheme}|${inclusive ? 1 : 0}`

const pct = (amount: number, bp: number) => mulDivRoundHalfUp(amount, bp, BP);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const gk = (rate: number, scheme: string, inclusive: boolean): GroupKey => `${rate}|${scheme}|${inclusive ? 1 : 0}`;
const parseGk = (k: GroupKey): [number, string, boolean] => {
  const [r, s, i] = k.split('|');
  return [Number(r), s, i === '1'];
};
// Python sorts group tuples (rate, scheme, inclusive); replicate that order.
const cmpGk = (a: GroupKey, b: GroupKey) => {
  const [ra, sa, ia] = parseGk(a);
  const [rb, sb, ib] = parseGk(b);
  if (ra !== rb) {
    return ra - rb;
  }
  if (sa !== sb) {
    return sa < sb ? -1 : 1;
  }
  return Number(ia) - Number(ib);
};

class Ctx {
  issues: Issue[] = [];
  currency = 'INR';
  add(code: string, message: string, ref: string | null = null, blocking = true) {
    this.issues.push({code, message, blocking, ref});
  }
}

function validateItem(it: ItemIn, ctx: Ctx) {
  const label = it.name || it.id;
  const q = it.quantity_milli ?? 1000;
  if (q <= 0) {
    ctx.add('invalid_quantity', `${label}: quantity must be more than zero.`, it.id);
  }
  if (it.unit_price_minor < 0) {
    ctx.add('invalid_price', `${label}: price can't be negative.`, it.id);
  }
  const rate = it.tax_rate_bp ?? 0;
  if (rate < 0 || rate > BP) {
    ctx.add('invalid_tax_rate', `${label}: tax rate must be between 0% and 100%.`, it.id);
  }
  if (!TAX_SCHEMES.includes(it.tax_scheme ?? 'gst')) {
    ctx.add('invalid_tax_scheme', `${label}: unknown tax type '${it.tax_scheme}'.`, it.id);
  }
  if (!SPLIT_MODES.includes(it.split_mode ?? 'equal')) {
    ctx.add('invalid_split_mode', `${label}: unknown split '${it.split_mode}'.`, it.id);
  }
  const ids = (it.consumers ?? []).map(c => c.member_id);
  if (new Set(ids).size !== ids.length) {
    ctx.add('duplicate_consumer', `${label}: a person is listed twice.`, it.id);
  }
  const d = it.discount;
  if (d) {
    if (!KINDS.includes(d.kind)) {
      ctx.add('invalid_discount', `${label}: unknown discount type.`, it.id);
    } else if (d.value < 0) {
      ctx.add('invalid_discount', `${label}: discount can't be negative.`, it.id);
    } else if (d.kind === 'percent' && d.value > BP) {
      ctx.add('discount_exceeds_amount', `${label}: discount can't be more than 100%.`, it.id);
    }
  }
}

function itemWeights(it: ItemIn, net: number, ctx: Ctx): Array<[string, number]> | null {
  const label = it.name || it.id;
  const consumers = it.consumers ?? [];
  if (!consumers.length) {
    ctx.add('item_unassigned', `${label} isn't assigned to anyone yet.`, it.id);
    return null;
  }
  const mode = it.split_mode ?? 'equal';
  if (mode === 'equal') {
    return consumers.map(c => [c.member_id, 1]);
  }
  const val = (c: {value?: number}) => c.value ?? 1;
  if (consumers.some(c => val(c) < 0)) {
    ctx.add('invalid_allocation', `${label}: shares can't be negative.`, it.id);
    return null;
  }
  const total = sum(consumers.map(val));
  if (mode === 'shares') {
    if (consumers.some(c => val(c) <= 0)) {
      ctx.add('invalid_allocation', `${label}: every share must be more than zero.`, it.id);
      return null;
    }
  } else if (mode === 'percent') {
    if (total !== BP) {
      ctx.add(
        'percent_not_100',
        `${label}: percentages add up to ${(total / 100).toFixed(2)}%, they must total exactly 100.00%.`,
        it.id,
      );
      return null;
    }
  } else if (mode === 'exact') {
    if (total !== net) {
      ctx.add(
        'exact_mismatch',
        `${label}: exact amounts add up to ${formatMoney(total, ctx.currency)} but the item is ${formatMoney(net, ctx.currency)}.`,
        it.id,
      );
      return null;
    }
  } else {
    return null;
  }
  if (total === 0) {
    return consumers.map(c => [c.member_id, 1]);
  }
  return consumers.map(c => [c.member_id, val(c)]);
}

function split(total: number, weights: Array<[string, number]>): Record<string, number> {
  if (sum(weights.map(([, w]) => w)) === 0) {
    return allocateEqual(
      total,
      weights.map(([k]) => k),
    );
  }
  return allocate(total, weights);
}

function components(scheme: string, rate: number, inclusiveTax: number | null, exclusiveBase: number | null): Comp[] {
  const half = Math.floor(rate / 2);
  if (inclusiveTax !== null) {
    if (scheme === 'cgst_sgst') {
      const sgst = Math.floor(inclusiveTax / 2);
      return [
        ['CGST', half, inclusiveTax - sgst],
        ['SGST', rate - half, sgst],
      ];
    }
    return [[scheme === 'igst' ? 'IGST' : 'GST', rate, inclusiveTax]];
  }
  const base = exclusiveBase ?? 0;
  if (scheme === 'cgst_sgst') {
    return [
      ['CGST', half, mulDivRoundHalfUp(base, half, BP)],
      ['SGST', rate - half, mulDivRoundHalfUp(base, rate - half, BP)],
    ];
  }
  return [[scheme === 'igst' ? 'IGST' : 'GST', rate, pct(base, rate)]];
}

function taxLines(
  comps: Comp[],
  computed: Comp[],
  rate: number,
  scheme: string,
  inclusive: boolean,
  base: number,
  fromReceipt: boolean,
): TaxLine[] {
  const compMap: Record<string, number> = Object.fromEntries(computed.map(([c, , a]) => [c, a]));
  return comps.map(([c, r, a]) => ({
    component: c,
    component_rate_bp: r,
    group_rate_bp: rate,
    scheme,
    inclusive,
    taxable_base: base,
    amount: a,
    computed_amount: compMap[c] ?? 0,
    source: fromReceipt ? 'receipt' : 'configured',
  }));
}

function sortComps(c: Comp[]): Comp[] {
  // Python sorts tuples: component, then rate, then amount.
  return [...c].sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2]));
}

function reportedByGroup(
  reported: ReportedTaxIn[],
  groups: Map<GroupKey, string[]>,
  charges: ChargeIn[],
  ctx: Ctx,
): Map<GroupKey, Comp[]> {
  const keys = new Set(groups.keys());
  for (const ch of charges) {
    if ((ch.tax_rate_bp ?? 0) > 0) {
      keys.add(gk(ch.tax_rate_bp ?? 0, ch.tax_scheme ?? 'gst', false));
    }
  }
  const wanted = new Map<string, Comp[]>();
  const order: string[] = [];
  for (const r of reported) {
    if (!TAX_COMPONENTS.includes(r.component) || r.amount_minor < 0 || r.rate_bp <= 0) {
      ctx.add('invalid_reported_tax', `Receipt tax line ${r.component} ${(r.rate_bp / 100).toFixed(2)}% is invalid.`);
      continue;
    }
    let key: string;
    if (r.component === 'CGST' || r.component === 'SGST') {
      key = `${r.rate_bp * 2}|cgst_sgst`;
    } else if (r.component === 'IGST') {
      key = `${r.rate_bp}|igst`;
    } else {
      key = `${r.rate_bp}|gst`;
    }
    if (!wanted.has(key)) {
      wanted.set(key, []);
      order.push(key);
    }
    wanted.get(key)!.push([r.component, r.rate_bp, r.amount_minor]);
  }
  const out = new Map<GroupKey, Comp[]>();
  for (const key of order) {
    const comps = wanted.get(key)!;
    const [rateS, scheme] = key.split('|');
    const rate = Number(rateS);
    const matches = [...keys].filter(k => {
      const [r, s] = parseGk(k);
      return r === rate && s === scheme;
    });
    const label = `${scheme.toUpperCase().replace('_', '+')} ${(rate / 100).toFixed(2)}%`;
    if (!matches.length) {
      ctx.add('reported_tax_unmatched', `The receipt shows ${label} but no item uses that rate. Set the item tax rates.`);
      continue;
    }
    if (matches.length > 1) {
      ctx.add(
        'reported_tax_ambiguous',
        `${label} applies to both tax-inclusive and tax-exclusive items; enter it per item instead.`,
      );
      continue;
    }
    const names = comps.map(c => c[0]).sort();
    const expected = scheme === 'cgst_sgst' ? ['CGST', 'SGST'] : [scheme === 'igst' ? 'IGST' : 'GST'];
    if (names.join(',') !== expected.join(',')) {
      ctx.add('reported_tax_incomplete', `${label}: enter each tax line exactly once (${expected.join(' and ')}).`);
      continue;
    }
    out.set(matches[0], sortComps(comps));
  }
  return out;
}

interface PersonAcc {
  gross: number;
  item_discounts: number;
  bill_discounts: number;
  tax_added: number;
  tax_included: number;
  charges: number;
  post_tax_discounts: number;
  rounding: number;
}

export function computeBill(bill: BillInput): BillResult {
  const ctx = new Ctx();
  let code = bill.currency?.toUpperCase?.() ?? '';
  if (!getCurrency(code)) {
    ctx.add('unknown_currency', `Currency ${bill.currency} isn't supported.`);
    code = 'INR';
  }
  ctx.currency = code;
  const unit = factor(code);
  const items = bill.items ?? [];
  const discounts = bill.discounts ?? [];
  const charges = bill.charges ?? [];

  if (!items.length) {
    ctx.add('no_items', 'Add at least one item or amount.');
  }
  const itemIds = items.map(i => i.id);
  if (new Set(itemIds).size !== itemIds.length) {
    ctx.add('duplicate_item', 'Two items share the same id.');
  }

  // 1-2. gross and item discounts
  const gross: Record<string, number> = {};
  const itemDisc: Record<string, number> = {};
  const running: Record<string, number> = {};
  for (const it of items) {
    validateItem(it, ctx);
    const g = mulDivRoundHalfUp(Math.max(it.quantity_milli ?? 1000, 0), Math.max(it.unit_price_minor, 0), 1000);
    let d = 0;
    const disc = it.discount;
    if (disc && KINDS.includes(disc.kind) && disc.value >= 0) {
      d = disc.kind === 'fixed' ? disc.value : pct(g, Math.min(disc.value, BP));
      if (d > g) {
        ctx.add('discount_exceeds_amount', `${it.name || it.id}: discount is more than the item's price.`, it.id);
        d = g;
      }
    }
    gross[it.id] = g;
    itemDisc[it.id] = d;
    running[it.id] = g - d;
  }
  const net = {...running};

  // 3. pre-tax bill discounts
  const billDisc: Record<string, number> = Object.fromEntries(items.map(i => [i.id, 0]));
  const discountResults: DiscountResult[] = [];
  for (const disc of discounts) {
    const stage = disc.stage ?? 'pre_tax';
    if (!STAGES.includes(stage) || !KINDS.includes(disc.kind) || disc.value < 0) {
      ctx.add('invalid_discount', `${disc.label || 'Discount'}: invalid discount settings.`, disc.id);
      continue;
    }
    if (stage !== 'pre_tax') {
      continue;
    }
    const eligIds = disc.item_ids ?? null;
    const eligible = items.filter(i => eligIds === null || eligIds.includes(i.id));
    if (eligIds !== null && eligible.length !== new Set(eligIds).size) {
      ctx.add('invalid_discount', `${disc.label || 'Discount'}: refers to an item that isn't on the bill.`, disc.id);
    }
    const base = sum(eligible.map(i => running[i.id]));
    let amount = disc.kind === 'fixed' ? disc.value : pct(base, Math.min(disc.value, BP));
    if (disc.kind === 'percent' && disc.value > BP) {
      ctx.add('discount_exceeds_amount', `${disc.label || 'Discount'}: can't be more than 100%.`, disc.id);
    }
    if (amount > base) {
      ctx.add('discount_exceeds_amount', `${disc.label || 'Discount'} is larger than the amount it applies to.`, disc.id);
      amount = base;
    }
    const alloc = amount ? allocate(amount, eligible.map(i => [i.id, running[i.id]] as [string, number])) : {};
    for (const [k, v] of Object.entries(alloc)) {
      running[k] -= v;
      billDisc[k] += v;
    }
    discountResults.push({
      id: disc.id,
      label: disc.label ?? '',
      stage,
      kind: disc.kind,
      value: disc.value,
      is_coupon: !!disc.is_coupon,
      amount,
      allocation: 'proportional',
      allocations: alloc,
    });
  }

  // tax groups
  const groups = new Map<GroupKey, string[]>();
  for (const it of items) {
    const rate = it.tax_rate_bp ?? 0;
    const scheme = it.tax_scheme ?? 'gst';
    if (rate > 0 && TAX_SCHEMES.includes(scheme) && rate <= BP) {
      const k = gk(rate, scheme, !!it.tax_inclusive);
      if (!groups.has(k)) {
        groups.set(k, []);
      }
      groups.get(k)!.push(it.id);
    }
  }
  const reported = reportedByGroup(bill.reported_taxes ?? [], groups, charges, ctx);

  const itemTax: Record<string, number> = Object.fromEntries(items.map(i => [i.id, 0]));
  const itemBase: Record<string, number> = {...running};
  const lines: TaxLine[] = [];

  // 4a. inclusive groups
  for (const key of [...groups.keys()].filter(k => parseGk(k)[2]).sort(cmpGk)) {
    const [rate, scheme] = parseGk(key);
    const ids = groups.get(key)!;
    const amt = sum(ids.map(i => running[i]));
    const computedBase = mulDivRoundHalfUp(amt, BP, BP + rate);
    const computed = components(scheme, rate, amt - computedBase, null);
    const rep = reported.get(key);
    let comps = rep ?? computed;
    let tax = sum(comps.map(c => c[2]));
    if (tax > amt) {
      ctx.add('tax_exceeds_amount', 'Reported tax is larger than the tax-inclusive amount.', `${rate}:${scheme}`);
      comps = computed;
      tax = amt - computedBase;
    }
    const base = amt - tax;
    const alloc = tax
      ? split(tax, ids.map(i => [i, running[i]] as [string, number]))
      : Object.fromEntries(ids.map(i => [i, 0]));
    for (const i of ids) {
      itemTax[i] = alloc[i];
      itemBase[i] = running[i] - alloc[i];
    }
    lines.push(...taxLines(comps, computed, rate, scheme, true, base, rep !== undefined));
  }

  // 5a. charge amounts
  const preTaxSubtotal = sum(Object.values(itemBase));
  const chargeAmount: Record<string, number> = {};
  for (const ch of charges) {
    const kind = ch.kind ?? 'fixed';
    const alloc = ch.allocation ?? 'proportional';
    const rate = ch.tax_rate_bp ?? 0;
    const scheme = ch.tax_scheme ?? 'gst';
    const bad = !CHARGE_TYPES.includes(ch.type) || !KINDS.includes(kind) || !ALLOCATIONS.includes(alloc);
    if (bad || rate < 0 || rate > BP || !TAX_SCHEMES.includes(scheme)) {
      ctx.add('invalid_charge', `${ch.label || 'Charge'}: invalid settings.`, ch.id);
      continue;
    }
    if (ch.value < 0 && !(ch.type === 'adjustment' && kind === 'fixed')) {
      ctx.add('invalid_charge', `${ch.label || 'Charge'} can't be negative.`, ch.id);
      continue;
    }
    if (kind === 'percent' && ch.value > BP) {
      ctx.add('invalid_charge', `${ch.label || 'Charge'} can't be more than 100%.`, ch.id);
      continue;
    }
    chargeAmount[ch.id] = kind === 'fixed' ? ch.value : pct(preTaxSubtotal, ch.value);
    if (rate && chargeAmount[ch.id] < 0) {
      ctx.add('invalid_charge', `${ch.label || 'Charge'}: a negative adjustment can't carry tax.`, ch.id);
    }
  }
  const validCharges = charges.filter(c => c.id in chargeAmount);

  // 4b. exclusive groups (items + taxable charges)
  const chargeTax: Record<string, number> = Object.fromEntries(validCharges.map(c => [c.id, 0]));
  const exKeys = new Set([...groups.keys()].filter(k => !parseGk(k)[2]));
  for (const ch of validCharges) {
    if ((ch.tax_rate_bp ?? 0) > 0 && chargeAmount[ch.id] > 0) {
      exKeys.add(gk(ch.tax_rate_bp ?? 0, ch.tax_scheme ?? 'gst', false));
    }
  }
  for (const key of [...exKeys].sort(cmpGk)) {
    const [rate, scheme] = parseGk(key);
    const members: Array<[string, number]> = (groups.get(key) ?? []).map(i => ['item:' + i, running[i]]);
    for (const ch of validCharges) {
      if (gk(ch.tax_rate_bp ?? 0, ch.tax_scheme ?? 'gst', false) === key && chargeAmount[ch.id] > 0) {
        members.push(['charge:' + ch.id, chargeAmount[ch.id]]);
      }
    }
    const base = sum(members.map(([, w]) => w));
    const computed = components(scheme, rate, null, base);
    const rep = reported.get(key);
    const comps = rep ?? computed;
    const tax = sum(comps.map(c => c[2]));
    if (tax && base === 0) {
      ctx.add('tax_without_base', 'Tax is reported for items that cost nothing.', `${rate}:${scheme}`);
      continue;
    }
    const alloc = tax ? split(tax, members) : Object.fromEntries(members.map(([k]) => [k, 0]));
    for (const [k, v] of Object.entries(alloc)) {
      const idx = k.indexOf(':');
      const kind = k.slice(0, idx);
      const ident = k.slice(idx + 1);
      if (kind === 'item') {
        itemTax[ident] = v;
      } else {
        chargeTax[ident] = v;
      }
    }
    lines.push(...taxLines(comps, computed, rate, scheme, false, base, rep !== undefined));
  }

  // items -> people
  const people: Record<string, PersonAcc> = {};
  const personItems: Record<string, Array<{item_id: string; name: string; amount: number}>> = {};
  const person = (mid: string) => {
    if (!people[mid]) {
      people[mid] = {
        gross: 0,
        item_discounts: 0,
        bill_discounts: 0,
        tax_added: 0,
        tax_included: 0,
        charges: 0,
        post_tax_discounts: 0,
        rounding: 0,
      };
      personItems[mid] = [];
    }
    return people[mid];
  };

  const itemResults: ItemResult[] = [];
  let unallocated = 0;
  for (const it of items) {
    const weights = itemWeights(it, net[it.id], ctx);
    const inclusive = !!it.tax_inclusive;
    const totalI = running[it.id] + (inclusive ? 0 : itemTax[it.id]);
    const shares: ItemShare[] = [];
    if (weights === null) {
      unallocated += totalI;
    } else {
      const sg = split(gross[it.id], weights);
      const sd = split(itemDisc[it.id], weights);
      const sb = split(billDisc[it.id], weights);
      const st = split(itemTax[it.id], weights);
      for (const [mid] of weights) {
        const p = person(mid);
        const shareTotal = sg[mid] - sd[mid] - sb[mid] + (inclusive ? 0 : st[mid]);
        p.gross += sg[mid];
        p.item_discounts += sd[mid];
        p.bill_discounts += sb[mid];
        if (inclusive) {
          p.tax_included += st[mid];
        } else {
          p.tax_added += st[mid];
        }
        shares.push({
          member_id: mid,
          gross: sg[mid],
          item_discount: sd[mid],
          bill_discount: sb[mid],
          tax: st[mid],
          total: shareTotal,
        });
        personItems[mid].push({item_id: it.id, name: it.name, amount: shareTotal});
      }
    }
    itemResults.push({
      id: it.id,
      name: it.name,
      gross: gross[it.id],
      item_discount: itemDisc[it.id],
      net: net[it.id],
      bill_discount: billDisc[it.id],
      amount_after_discounts: running[it.id],
      taxable_base: itemBase[it.id],
      tax: itemTax[it.id],
      tax_inclusive: inclusive,
      tax_rate_bp: it.tax_rate_bp ?? 0,
      tax_scheme: it.tax_scheme ?? 'gst',
      total: totalI,
      assigned: weights !== null,
      shares,
    });
  }

  const memberIds = Object.keys(people).sort();
  const runningPerson = (): Record<string, number> =>
    Object.fromEntries(
      Object.entries(people).map(([m, p]) => [
        m,
        p.gross - p.item_discounts - p.bill_discounts + p.tax_added + p.charges - p.post_tax_discounts + p.rounding,
      ]),
    );
  const spread = (amount: number, mode: string, weights: Record<string, number>): Record<string, number> | null => {
    if (!memberIds.length) {
      return null;
    }
    if (mode === 'equal' || !memberIds.some(m => (weights[m] ?? 0) > 0)) {
      return allocateEqual(amount, memberIds);
    }
    return allocate(
      amount,
      memberIds.map(m => [m, Math.max(weights[m] ?? 0, 0)] as [string, number]),
    );
  };

  // 5b. charges -> people
  const preChargeWeights: Record<string, number> = Object.fromEntries(
    Object.entries(people).map(([m, p]) => [m, p.gross - p.item_discounts - p.bill_discounts]),
  );
  const chargeResults: ChargeResult[] = [];
  for (const ch of validCharges) {
    const amount = chargeAmount[ch.id];
    const tax = chargeTax[ch.id];
    let alloc = spread(amount + tax, ch.allocation ?? 'proportional', preChargeWeights);
    if (alloc === null) {
      unallocated += amount + tax;
      alloc = {};
    }
    for (const [m, v] of Object.entries(alloc)) {
      people[m].charges += v;
    }
    chargeResults.push({
      id: ch.id,
      label: ch.label ?? '',
      type: ch.type,
      kind: ch.kind ?? 'fixed',
      value: ch.value,
      amount,
      tax,
      total: amount + tax,
      allocation: ch.allocation ?? 'proportional',
      allocations: alloc,
    });
  }

  const itemsAfter = sum(Object.values(running));
  const taxAdded = sum(items.filter(i => !i.tax_inclusive).map(i => itemTax[i.id]));
  const taxIncluded = sum(items.filter(i => i.tax_inclusive).map(i => itemTax[i.id]));
  const chargesTotal = sum(chargeResults.map(c => c.amount));
  const chargesTax = sum(chargeResults.map(c => c.tax));
  const subtotal = itemsAfter + taxAdded + chargesTotal + chargesTax;

  // 6. post-tax discounts
  let postTotal = 0;
  for (const disc of discounts) {
    if ((disc.stage ?? 'pre_tax') !== 'post_tax' || !KINDS.includes(disc.kind) || disc.value < 0) {
      continue;
    }
    const allocMode = disc.allocation ?? 'proportional';
    if (!ALLOCATIONS.includes(allocMode)) {
      ctx.add('invalid_discount', `${disc.label || 'Discount'}: unknown allocation.`, disc.id);
      continue;
    }
    const base = subtotal - postTotal;
    let amount = disc.kind === 'fixed' ? disc.value : pct(base, Math.min(disc.value, BP));
    if (amount > base) {
      ctx.add('discount_exceeds_amount', `${disc.label || 'Discount'} is larger than the bill.`, disc.id);
      amount = Math.max(base, 0);
    }
    let alloc = spread(amount, allocMode, runningPerson());
    if (alloc === null) {
      unallocated -= amount;
      alloc = {};
    }
    for (const [m, v] of Object.entries(alloc)) {
      people[m].post_tax_discounts += v;
    }
    postTotal += amount;
    discountResults.push({
      id: disc.id,
      label: disc.label ?? '',
      stage: 'post_tax',
      kind: disc.kind,
      value: disc.value,
      is_coupon: !!disc.is_coupon,
      amount,
      allocation: allocMode,
      allocations: alloc,
    });
  }

  // 7. rounding
  const beforeRounding = subtotal - postTotal;
  let rounding = 0;
  const rmode = bill.rounding?.mode ?? 'none';
  if (!ROUNDING_MODES.includes(rmode)) {
    ctx.add('invalid_rounding', 'Unknown rounding rule.');
  } else if (rmode === 'explicit') {
    rounding = bill.rounding?.amount_minor ?? 0;
    if (Math.abs(rounding) >= unit && unit > 1) {
      ctx.add(
        'large_rounding',
        'The rounding adjustment is a whole unit or more; check it against the receipt.',
        null,
        false,
      );
    }
  } else if (rmode === 'nearest_unit') {
    rounding = divRoundHalfUp(beforeRounding, unit) * unit - beforeRounding;
  }
  if (rounding) {
    const alloc = spread(rounding, 'proportional', runningPerson());
    if (alloc === null) {
      unallocated += rounding;
    } else {
      for (const [m, v] of Object.entries(alloc)) {
        people[m].rounding += v;
      }
    }
  }

  const total = beforeRounding + rounding;
  if (total < 0) {
    ctx.add('negative_total', 'Discounts make the bill negative.');
  }
  let receiptDiff: number | null = null;
  const receiptTotal = bill.receipt_total_minor ?? null;
  if (receiptTotal !== null) {
    receiptDiff = total - receiptTotal;
    if (receiptDiff) {
      ctx.add(
        'receipt_total_mismatch',
        "The calculated total doesn't match the receipt. Fix the items, or add a labelled adjustment.",
      );
    }
  }

  const finalRunning = runningPerson();
  const personResults: PersonResult[] = memberIds.map(m => ({
    member_id: m,
    ...people[m],
    total: finalRunning[m],
    items: personItems[m],
  }));
  const allocated = sum(personResults.map(p => p.total));
  if (allocated + unallocated !== total) {
    throw new Error('allocation does not conserve the bill total');
  }

  const taxableCharges = sum(validCharges.filter(c => c.tax_rate_bp).map(c => chargeAmount[c.id]));
  return {
    engine_version: ENGINE_VERSION,
    currency: code,
    item_gross: sum(Object.values(gross)),
    item_discounts: sum(Object.values(itemDisc)),
    items_net: sum(Object.values(net)),
    pre_tax_discounts: sum(Object.values(billDisc)),
    taxable_base: sum(Object.values(itemBase)) + taxableCharges,
    tax_added: taxAdded,
    tax_included: taxIncluded,
    tax_total: taxAdded + taxIncluded + chargesTax,
    charges: chargesTotal,
    charges_tax: chargesTax,
    post_tax_discounts: postTotal,
    rounding,
    total,
    receipt_total: receiptTotal,
    receipt_difference: receiptDiff,
    allocated_total: allocated,
    unallocated,
    items: itemResults,
    discounts: discountResults,
    charge_lines: chargeResults,
    tax_lines: lines,
    people: personResults,
    issues: ctx.issues,
    can_finalize: !ctx.issues.some(i => i.blocking),
  };
}
