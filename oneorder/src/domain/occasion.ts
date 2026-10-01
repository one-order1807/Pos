import type { Customer } from './types';

export function occasionLine(customer: Pick<Customer, 'event'> | undefined, enabled: boolean): string | undefined {
  if (!enabled) return undefined;
  const event = customer?.event;
  if (event === 'Birthday') return 'Happy Birthday!';
  if (event === 'Anniversary') return 'Happy Anniversary!';
  return undefined;
}
