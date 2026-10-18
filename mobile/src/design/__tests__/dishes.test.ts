import {dishEmoji, FALLBACK_DISH} from '../dishes';

test.each([
  ['Chicken Biryani', '🍛'],
  ['Hyderabadi Mutton Biryani', '🍛'],
  ['Margherita Pizza', '🍕'],
  ['Masala Chai', '🍵'],
  ['Cutting chai', '🍵'],
  ['Cold Coffee', '☕'],
  ['Mango Lassi', '🥛'],
  ['Paneer Butter Masala', '🍲'],
  ['Dal Makhani', '🍲'],
  ['Masala Dosa', '🫓'],
  ['Butter Naan', '🫓'],
  ['Veg Momos', '🥟'],
  ['Hakka Noodles', '🍜'],
  ['Gulab Jamun', '🍮'],
  ['Watermelon juice', '🥤'],
  ['Watermelon', '🍎'],
  ['Mineral water', '💧'],
  ['Ginger chicken', '🍗'],
  ['Chicken drumsticks', '🍗'],
  ['Kingfisher Beer', '🍺'],
])('%s -> %s', (name, emoji) => {
  expect(dishEmoji(name)).toBe(emoji);
});

test('unknown dishes get the neutral plate, never a guess', () => {
  expect(dishEmoji('Chef special #7')).toBe(FALLBACK_DISH);
  expect(dishEmoji('Electricity bill')).toBe(FALLBACK_DISH);
});
