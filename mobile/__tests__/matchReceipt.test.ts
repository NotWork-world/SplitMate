import {emptyPayload, matchReceiptPatch, newItem, preview} from '../src/features/expenses/draft';

const bill = (receipt: number) => {
  const p = emptyPayload('INR', 'me', true);
  p.items = [
    newItem({client_id: 'a', name: 'Dosa', unit_price_minor: 68000, consumers: [{member_id: 'me', value: 1}]}),
    newItem({client_id: 'b', name: 'Water', unit_price_minor: 6000, consumers: [{member_id: 'ravi', value: 1}]}),
  ];
  p.receipt_total_minor = receipt;
  return p;
};

describe('matching the receipt total', () => {
  it('adds the shortfall as a fee shared by order, so the total matches exactly', () => {
    const p = bill(74578);
    const fixed = {...p, ...matchReceiptPatch(p)!};
    const r = preview(fixed).result;
    expect(r.total).toBe(74578);
    expect(r.issues.some(i => i.code === 'receipt_total_mismatch')).toBe(false);
    const share = Object.fromEntries(r.people.map(x => [x.member_id, x.total]));
    expect(share.me + share.ravi).toBe(74578);
    expect(share.me).toBeGreaterThan(share.ravi); // bigger order, bigger part of the gap
  });

  it('takes an overcharge off as a discount, and re-running replaces rather than stacks', () => {
    const p = bill(73500);
    const once = {...p, ...matchReceiptPatch(p)!};
    const twice = {...once, ...matchReceiptPatch(once)!};
    expect(preview(twice).result.total).toBe(73500);
    expect(twice.discounts).toHaveLength(1);
    expect(twice.charges).toHaveLength(0);
  });

  it('does nothing when there is no printed total or it already matches', () => {
    expect(matchReceiptPatch({...bill(0), receipt_total_minor: null})).toBeNull();
    expect(matchReceiptPatch(bill(74000))).toBeNull();
  });
});
