import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider} from '../../../design';
import type {ExpensePayload} from '../../../api/types';
import {BillExtras} from '../Extras';
import {emptyPayload, newCharge, newDiscount, newItem, preview} from '../draft';

let latest: ExpensePayload;

function Harness({initial}: {initial: ExpensePayload}) {
  const [p, setP] = useState(initial);
  latest = p;
  return <BillExtras payload={p} result={preview(p).result} onChange={patch => setP(prev => ({...prev, ...patch}))} />;
}

async function setup() {
  const p = emptyPayload('INR', 'ma');
  p.items = [newItem({client_id: 'i1', name: 'Paneer', unit_price_minor: 30000})];
  p.charges = [newCharge({client_id: 'tip', type: 'tip', label: 'Tip', kind: 'fixed', value: 5000}), newCharge({client_id: 'svc', type: 'service', label: 'Service charge', kind: 'fixed', value: 286})];
  p.discounts = [newDiscount({client_id: 'd1', label: 'Happy hours', kind: 'fixed', value: 1000})];
  await render(
    <SafeAreaProvider initialMetrics={{frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}}}>
      <ThemeProvider preference="light">
        <Harness initial={p} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

test('one tip, charge or discount can be deleted on its own', async () => {
  await setup();
  await fireEvent.press(screen.getByTestId('remove-charge-svc'));
  expect(latest.charges.map(c => c.client_id)).toEqual(['tip']);
  await fireEvent.press(screen.getByTestId('remove-discount-d1'));
  expect(latest.discounts).toEqual([]);
  expect(latest.charges.map(c => c.client_id)).toEqual(['tip']);
});

test('the charge sheet has a Delete button for an existing charge', async () => {
  await setup();
  await fireEvent.press(screen.getByText('Tip'));
  await fireEvent.press(screen.getByTestId('charge-delete'));
  expect(latest.charges.map(c => c.client_id)).toEqual(['svc']);
});
