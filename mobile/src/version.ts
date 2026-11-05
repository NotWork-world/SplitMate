/** Version comparison for the update check: "0.7.0" is newer than "0.6.10". */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/, '')
      .split('.')
      .slice(0, 3)
      .map(n => parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) {
      return true;
    }
    if ((b[i] ?? 0) < (a[i] ?? 0)) {
      return false;
    }
  }
  return false;
}
