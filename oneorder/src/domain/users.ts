import type { Customer, EventType } from './types';

export type EventFilter = 'all' | EventType | 'none';

export function filterUsers(customers: Record<string, Customer>, query: string, filter: EventFilter): Customer[] {
  const q = query.trim().toLowerCase();
  return Object.values(customers)
    .filter((u) => (filter === 'all' ? true : filter === 'none' ? !u.event : u.event === filter))
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.phone.includes(q))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name));
}

export function usersToRows(list: Customer[]): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: ['Sr. No.', 'Name', 'Phone', 'Event'],
    rows: list.map((u, i) => [i + 1, u.name, u.phone, u.event || '']),
  };
}
