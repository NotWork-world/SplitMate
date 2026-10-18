import {canFinalize, emptyPayload, newDiscount, newItem, preview, toBillInput} from '../draft';

const A = 'member-a';
const B = 'member-b';

function bill() {
  const p = emptyPayload('INR', A);
  p.title = 'Dinner';
  p.items = [
    newItem({client_id: 'i1', name: 'Paneer', unit_price_minor: 30000, tax_rate_bp: 500, consumers: [{member_id: A, value: 1}, {member_id: B, value: 1}]}),
    newItem({client_id: 'i2', name: 'Biryani', unit_price_minor: 25000, tax_rate_bp: 500, consumers: [{member_id: A, value: 1}, {member_id: B, value: 1}]}),
    newItem({client_id: 'i3', name: 'Drinks', unit_price_minor: 10000, tax_rate_bp: 500, consumers: [{member_id: A, value: 1}, {member_id: B, value: 1}]}),
  ];
  p.discounts = [newDiscount({client_id: 'd1', label: 'Discount', kind: 'fixed', value: 5000})];
  return p;
}

test('the prompt example previews to ₹630.00, ₹315.00 each, payer pays all', () => {
  const pv = preview(bill());
  expect(pv.result.total).toBe(63000);
  expect(pv.result.people.map(x => x.total)).toEqual([31500, 31500]);
  expect(pv.paid).toEqual({[A]: 63000});
  expect(canFinalize(pv)).toBe(true);
});

test('payload is translated exactly like the server does', () => {
  const input = toBillInput(bill());
  expect(input.items[0]).toEqual({
    id: 'i1',
    name: 'Paneer',
    quantity_milli: 1000,
    unit_price_minor: 30000,
    discount: null,
    tax_rate_bp: 500,
    tax_inclusive: false,
    tax_scheme: 'gst',
    split_mode: 'equal',
    consumers: [
      {member_id: A, value: 1},
      {member_id: B, value: 1},
    ],
  });
  expect(input.discounts![0]).toMatchObject({id: 'd1', kind: 'fixed', value: 5000, stage: 'pre_tax', item_ids: null});
});

test('an unassigned dish blocks finalisation; nobody is assigned automatically', () => {
  const p = bill();
  p.items[2].consumers = [];
  const pv = preview(p);
  expect(pv.result.unallocated).toBe(9692);
  expect(pv.result.issues.map(i => i.code)).toContain('item_unassigned');
  expect(canFinalize(pv)).toBe(false);
});

test('several payers must add up to the total', () => {
  const p = bill();
  p.payers = [
    {member_id: A, amount_minor: 40000},
    {member_id: B, amount_minor: 20000},
  ];
  const pv = preview(p);
  expect(pv.payerIssue).toMatch("doesn't add up");
  expect(canFinalize(pv)).toBe(false);
  p.payers[1].amount_minor = 23000;
  expect(canFinalize(preview(p))).toBe(true);
});

test('no payer chosen blocks finalisation', () => {
  const p = bill();
  p.payers = [];
  expect(preview(p).payerIssue).toBe('Choose who paid.');
});
