import {normalizePhone, usernameError} from '../src/people/invite';

describe('phone numbers for WhatsApp', () => {
  it.each([
    ['98765 43210', '919876543210'],
    ['098765-43210', '919876543210'],
    ['+91 98765 43210', '919876543210'],
    ['+1 (415) 555-0100', '14155550100'],
    ['0044 20 7946 0958', '442079460958'],
  ])('%s -> %s', (raw, out) => expect(normalizePhone(raw)).toBe(out));

  it('rejects things that are not phone numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('usernames', () => {
  it('accepts handles the server accepts', () => {
    expect(usernameError('@Asha_Rao')).toBeNull();
    expect(usernameError('bina.s')).toBeNull();
    expect(usernameError('')).toBeNull();
  });
  it('rejects bad ones', () => {
    expect(usernameError('ab')).not.toBeNull();
    expect(usernameError('_asha')).not.toBeNull();
    expect(usernameError('has space')).not.toBeNull();
  });
});
