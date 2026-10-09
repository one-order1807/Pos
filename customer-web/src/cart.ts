import { useCallback, useEffect, useState } from 'react';

export interface CartLine {
  itemId: string;
  qty: number;
  note: string;
}

function storageKey(token: string): string {
  return `oneorder-cart-${token}`;
}

function readCart(token: string): CartLine[] {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Private browsing, storage disabled, or corrupt JSON - an empty cart is a safe fallback,
    // never a crash over something this unimportant.
    return [];
  }
}

function writeCart(token: string, lines: CartLine[]): void {
  try {
    localStorage.setItem(storageKey(token), JSON.stringify(lines));
  } catch {
    // Same as above - the cart just won't survive a refresh this time, which is not worth
    // surfacing as an error to someone trying to order food.
  }
}

/** A cart scoped to one table's token, persisted across a refresh/re-open of the same link -
 * never shared between two different tables' QR links, even in the same browser. */
export function useCart(token: string) {
  const [lines, setLines] = useState<CartLine[]>(() => readCart(token));

  useEffect(() => {
    setLines(readCart(token));
  }, [token]);

  useEffect(() => {
    writeCart(token, lines);
  }, [token, lines]);

  const addItem = useCallback((itemId: string, qty = 1, note = '') => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === itemId && l.note === note);
      if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l));
      return [...prev, { itemId, qty, note }];
    });
  }, []);

  const setQty = useCallback((itemId: string, qty: number) => {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.itemId !== itemId) : prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l))));
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);

  return { lines, addItem, setQty, removeItem, clear, totalQty };
}
