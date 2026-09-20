export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(n: number): string {
  const v = round2(n);
  const neg = v < 0;
  const abs = Math.abs(v);
  const hasFraction = Math.abs(abs - Math.round(abs)) > 0.0001;
  const fixed = hasFraction ? abs.toFixed(2) : String(Math.round(abs));
  const [intPart, frac] = fixed.split('.');
  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `${neg ? '-' : ''}Rs ${grouped}${frac ? '.' + frac : ''}`;
}

export function parseGstPercent(raw: string): number {
  const cleaned = String(raw ?? '')
    .replace('%', '')
    .trim();
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

export function formatPercent(p: number): string {
  return Number.isInteger(p) ? String(p) : String(round2(p));
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
