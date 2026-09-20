export function makeTapGuard(windowMs: number) {
  const last = new Map<string, number>();
  return function allow(key: string, now: number): boolean {
    const prev = last.get(key);
    if (prev !== undefined && now - prev >= 0 && now - prev < windowMs) return false;
    last.set(key, now);
    return true;
  };
}
