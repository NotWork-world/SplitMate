import bills from '../../../../shared/fixtures/bills.json';
import parity from '../../../../shared/fixtures/parity.json';
import {allocate} from '../allocate';
import {computeBill} from '../engine';
import type {BillInput, BillResult} from '../types';

type Case = {name: string; input: BillInput; expect: Record<string, any>};

describe('shared hand-calculated fixtures', () => {
  for (const c of (bills as unknown as {cases: Case[]}).cases) {
    test(c.name, () => {
      const r = computeBill(c.input) as unknown as Record<string, any>;
      for (const [key, want] of Object.entries(c.expect)) {
        if (key === 'people') {
          expect(Object.fromEntries(r.people.map((p: any) => [p.member_id, p.total]))).toEqual(want);
        } else if (key === 'items') {
          expect(Object.fromEntries(r.items.map((i: any) => [i.id, i.total]))).toEqual(want);
        } else if (key === 'issues') {
          expect([...new Set(r.issues.map((i: any) => i.code))].sort()).toEqual([...(want as string[])].sort());
        } else if (key === 'tax_lines') {
          expect(r.tax_lines).toHaveLength((want as any[]).length);
          (want as any[]).forEach((exp, i) => expect(r.tax_lines[i]).toMatchObject(exp));
        } else if (key === 'discount_allocations') {
          const got = Object.fromEntries(r.discounts.map((d: any) => [d.id, d.allocations]));
          for (const [id, alloc] of Object.entries(want)) {
            expect(got[id]).toEqual(alloc);
          }
        } else if (key === 'charge_allocations') {
          const got = Object.fromEntries(r.charge_lines.map((d: any) => [d.id, d.allocations]));
          for (const [id, alloc] of Object.entries(want)) {
            expect(got[id]).toEqual(alloc);
          }
        } else {
          expect(r[key]).toEqual(want);
        }
      }
      expect(r.allocated_total + r.unallocated).toBe(r.total);
    });
  }
});

describe('parity with the Python engine (300 generated bills)', () => {
  const cases = (parity as unknown as {cases: Array<{input: BillInput; output: BillResult}>}).cases;
  test.each(cases.map((c, i) => [i, c]))('bill %i matches field for field', (_i, c) => {
    expect(computeBill(c.input)).toEqual(c.output);
  });
});

describe('allocate', () => {
  test('ties go to the smaller key, symmetric for negatives', () => {
    expect(allocate(2, [['b', 1], ['c', 1], ['a', 1]])).toEqual({a: 1, b: 1, c: 0});
    expect(allocate(-2, [['b', 1], ['c', 1], ['a', 1]])).toEqual({a: -1, b: -1, c: 0});
  });
  test('huge weights do not lose precision', () => {
    const r = allocate(9_999_999_999_999, [['a', 9_999_999_999_999], ['b', 1]]);
    expect(r.a + r.b).toBe(9_999_999_999_999);
    expect(r.b).toBe(1);
  });
});
