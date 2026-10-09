import { motion } from 'framer-motion';
import type { MenuItem } from '../api';
import type { CartLine } from '../cart';

interface Props {
  items: MenuItem[];
  lines: CartLine[];
  onSetQty: (itemId: string, qty: number) => void;
  onClose: () => void;
  onPlaceOrder: () => void;
  placing: boolean;
  placeError: string;
}

export function CartSheet({ items, lines, onSetQty, onClose, onPlaceOrder, placing, placeError }: Props) {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const subtotal = lines.reduce((sum, l) => {
    const item = itemsById.get(l.itemId);
    return item ? sum + Number(item.price) * l.qty : sum;
  }, 0);

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-hidden
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="relative z-10 flex max-h-[80vh] flex-col rounded-t-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-muted px-5 py-4">
          <h2 className="text-lg font-semibold text-text">Your order</h2>
          <button onClick={onClose} className="text-sm font-medium text-text-soft" aria-label="Close cart">
            Close
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-soft">Your cart is empty.</p>
        ) : (
          <div className="scroll-touch flex-1 overflow-y-auto px-5 py-3">
            {lines.map((line) => {
              const item = itemsById.get(line.itemId);
              if (!item) return null;
              return (
                <div key={line.itemId} className="flex items-center justify-between gap-3 border-b border-muted py-3 last:border-none">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text">{item.name}</p>
                    <p className="text-sm text-text-soft">Rs {Number(item.price).toFixed(0)} each</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 rounded-full bg-muted px-1">
                    <button onClick={() => onSetQty(line.itemId, line.qty - 1)} className="h-8 w-8 rounded-full text-lg font-semibold text-primary-dark active:scale-90">
                      −
                    </button>
                    <span className="w-4 text-center text-sm font-semibold text-text">{line.qty}</span>
                    <button onClick={() => onSetQty(line.itemId, line.qty + 1)} className="h-8 w-8 rounded-full text-lg font-semibold text-primary-dark active:scale-90">
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-muted px-5 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="mb-3 flex items-center justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>Rs {subtotal.toFixed(0)}</span>
          </div>
          {placeError ? <p className="mb-2 text-sm text-danger">{placeError}</p> : null}
          <button
            onClick={onPlaceOrder}
            disabled={lines.length === 0 || placing}
            className="w-full rounded-brand bg-primary py-3 text-center font-semibold text-white disabled:opacity-50"
          >
            {placing ? 'Placing order...' : 'Place order'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
