import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {Provider} from 'react-redux';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {splitApi} from '../../../api/endpoints';
import type {Group} from '../../../api/types';
import {ThemeProvider, ToastProvider} from '../../../design';
import {store} from '../../../store';
import {ClaimDishesScreen} from '../ClaimDishesScreen';
import {createDraft, draftActions, emptyPayload, newItem} from '../draft';

const GROUP: Group = {
  id: 'g1',
  name: 'Friday dinner',
  type: 'friends',
  emoji: null,
  currency: 'INR',
  start_date: null,
  end_date: null,
  archived: false,
  created_at: '2026-10-01T00:00:00Z',
  my_member_id: 'ma',
  my_role: 'owner',
  members: [
    {id: 'ma', display_name: 'Asha', user_id: 'u1', role: 'owner', status: 'active', is_me: true, is_registered: true, avatar_hue: 200},
    {id: 'mb', display_name: 'Bina', user_id: null, role: 'member', status: 'active', is_me: false, is_registered: false, avatar_hue: 20},
  ],
  my_balances: [],
  expense_count: 0,
};

const Stack = createNativeStackNavigator<any>();

async function setup() {
  store.dispatch(draftActions.loaded({}));
  store.dispatch(splitApi.util.upsertQueryData('group', 'g1', GROUP));
  const payload = emptyPayload('INR', 'ma');
  payload.title = 'Dinner';
  payload.items = [
    newItem({client_id: 'i1', name: 'Chicken Biryani', unit_price_minor: 30000}),
    newItem({client_id: 'i2', name: 'Masala Chai', unit_price_minor: 4000}),
  ];
  const d = createDraft('g1', payload);
  store.dispatch(draftActions.upsert(d));
  await render(
    <Provider store={store}>
      <SafeAreaProvider initialMetrics={{frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}}}>
        <ThemeProvider preference="dark">
          <ToastProvider>
            <NavigationContainer>
              <Stack.Navigator>
                <Stack.Screen name="ClaimDishes" component={ClaimDishesScreen as any} initialParams={{localId: d.localId}} />
                <Stack.Screen name="BillReview" component={() => null} />
              </Stack.Navigator>
            </NavigationContainer>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </Provider>,
  );
  return d.localId;
}

const item = (localId: string, id: string) => store.getState().drafts.byId[localId].payload.items.find(i => i.client_id === id)!;

test('claim needs a person, skip leaves the dish unassigned, undo restores it', async () => {
  const localId = await setup();
  expect(await screen.findByText('Chicken Biryani')).toBeTruthy();
  expect(screen.getByText('0 of 2 items reviewed')).toBeTruthy();

  // Claim is disabled until someone is picked: silence is never consent.
  await fireEvent.press(screen.getByTestId('claim-claim'));
  expect(item(localId, 'i1').consumers).toEqual([]);

  // Pick Bina and claim (the non-swipe alternative to swiping right).
  await fireEvent.press(screen.getByRole('checkbox', {name: /^Bina/}));
  expect(screen.getAllByText('₹300.00').length).toBeGreaterThan(0); // Bina's exact share shown on the card
  await fireEvent.press(screen.getByTestId('claim-claim'));
  expect(item(localId, 'i1')).toMatchObject({consumers: [{member_id: 'mb', value: 1}], review_state: 'claimed'});

  // Next card: skip it. It stays unassigned.
  expect(await screen.findByText('Masala Chai')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('claim-skip'));
  expect(item(localId, 'i2')).toMatchObject({consumers: [], review_state: 'skipped'});
  expect(await screen.findByText(/item was skipped/)).toBeTruthy();

  // Undo brings the skipped card back as it was.
  await fireEvent.press(screen.getByLabelText('Undo last'));
  expect(item(localId, 'i2').review_state).toBe('pending');
  expect(await screen.findByText('Masala Chai')).toBeTruthy();
});

test('the list view assigns dishes without any swiping', async () => {
  const localId = await setup();
  await fireEvent.press(await screen.findByLabelText('Switch to list'));
  const chips = await screen.findAllByLabelText('You');
  await fireEvent.press(chips[1]); // second dish: Masala Chai
  expect(item(localId, 'i2')).toMatchObject({consumers: [{member_id: 'ma', value: 1}], review_state: 'claimed'});
  expect(item(localId, 'i1').consumers).toEqual([]);
  expect(await screen.findByText('1 item still needs someone')).toBeTruthy();
});
