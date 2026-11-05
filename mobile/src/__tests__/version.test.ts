import {isNewerVersion} from '../version';

describe('isNewerVersion', () => {
  it('sees a newer major/minor/patch as newer', () => {
    expect(isNewerVersion('0.6.0', '0.7.0')).toBe(true);
    expect(isNewerVersion('0.6.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.5.0', '1.6.0')).toBe(true);
    expect(isNewerVersion('1.5.0', '1.5.1')).toBe(true);
  });

  it('does not see an equal or older version as newer', () => {
    expect(isNewerVersion('0.7.0', '0.6.0')).toBe(false);
    expect(isNewerVersion('0.7.0', '0.7.0')).toBe(false);
  });

  it('reads a v prefix (git tags) and bare versions the same way', () => {
    expect(isNewerVersion('0.6.0', 'v0.7.0')).toBe(true);
    expect(isNewerVersion('0.7.0', '0.6.10')).toBe(false);
  });

  it('falls back to zeros when a part is missing (undefined is newer)', () => {
    expect(isNewerVersion('0.6', '0.7')).toBe(true);
    expect(isNewerVersion('0.6', '0.6')).toBe(false);
  });
});
