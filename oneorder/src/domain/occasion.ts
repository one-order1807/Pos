import type { Customer } from './types';

export function occasionLine(
  customer: Pick<Customer, 'event' | 'name'> | undefined,
  fallbackName: string,
  enabled: boolean,
): string | undefined {
  if (!enabled) return undefined;
  const event = customer?.event;
  const name = (fallbackName || customer?.name || '').trim();
  if (event === 'Birthday') return name ? `Happy Birthday, ${name}!` : 'Happy Birthday!';
  if (event === 'Anniversary') return 'Happy Anniversary!';
  return undefined;
}
