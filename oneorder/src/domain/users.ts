import type { Customer, EventType } from './types';

export type EventFilter = 'all' | EventType | 'none';

export function filterUsers(customers: Record<string, Customer>, query: string, filter: EventFilter): Customer[] {
  const q = query.trim().toLowerCase();
  return Object.values(customers)
    .filter((u) => (filter === 'all' ? true : filter === 'none' ? !u.event : u.event === filter))
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.phone.includes(q))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name));
}

/** Existing customers whose name contains `query` (3+ chars), most recent first - for the "is this
 * an existing customer?" suggestion list shown while typing a name at bill time. */
export function matchCustomersByName(customers: Record<string, Customer>, query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  return Object.values(customers)
    .filter((u) => u.name.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
}

export function usersToRows(list: Customer[]): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: ['Sr. No.', 'Name', 'Phone', 'Event'],
    rows: list.map((u, i) => [i + 1, u.name, u.phone, u.event || '']),
  };
}
