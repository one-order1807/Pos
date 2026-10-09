import { useMemo, useState } from 'react';
import type { MenuCategory, MenuItem } from '../api';
import type { CartLine } from '../cart';

interface Props {
  categories: MenuCategory[];
  items: MenuItem[];
  cartLines: CartLine[];
  onAdd: (itemId: string) => void;
  onSetQty: (itemId: string, qty: number) => void;
}

export function MenuBrowser({ categories, items, cartLines, onAdd, onSetQty }: Props) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');

  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.sort - b.sort), [categories]);

  const qtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cartLines) map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.qty);
    return map;
  }, [cartLines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== 'all' && item.category_id !== activeCategory) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, activeCategory, query]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of filtered) {
      const list = groups.get(item.category_id) ?? [];
      list.push(item);
      groups.set(item.category_id, list);
    }
    return groups;
  }, [filtered]);

  return (
    <div>
      <div className="sticky top-0 z-10 bg-bg-soft/95 px-4 pb-3 pt-4 backdrop-blur">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the menu..."
          className="w-full rounded-brand border border-muted bg-white px-4 py-2.5 text-sm text-text shadow-sm outline-none focus:border-primary"
        />
        <div className="scroll-touch mt-3 flex gap-2 overflow-x-auto pb-1">
          <CategoryChip label="All" active={activeCategory === 'all'} onClick={() => setActiveCategory('all')} />
          {sortedCategories.map((c) => (
            <CategoryChip key={c.id} label={c.name} active={activeCategory === c.id} onClick={() => setActiveCategory(c.id)} />
          ))}
        </div>
      </div>

      <div className="px-4 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-text-soft">
            <div className="text-3xl">🔍</div>
            <p className="text-sm">No items match "{query}".</p>
          </div>
        ) : activeCategory === 'all' ? (
          sortedCategories
            .filter((c) => byCategory.has(c.id))
            .map((c) => (
              <section key={c.id} className="mt-5">
                <h2 className="mb-2 text-lg font-semibold text-text">{c.name}</h2>
                <div className="flex flex-col gap-2">
                  {byCategory.get(c.id)!.map((item) => (
                    <ItemRow key={item.id} item={item} qty={qtyByItem.get(item.id) ?? 0} onAdd={() => onAdd(item.id)} onSetQty={(q) => onSetQty(item.id, q)} />
                  ))}
                </div>
              </section>
            ))
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            {filtered.map((item) => (
              <ItemRow key={item.id} item={item} qty={qtyByItem.get(item.id) ?? 0} onAdd={() => onAdd(item.id)} onSetQty={(q) => onSetQty(item.id, q)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-white text-text-soft'
      }`}
    >
      {label}
    </button>
  );
}

function ItemRow({ item, qty, onAdd, onSetQty }: { item: MenuItem; qty: number; onAdd: () => void; onSetQty: (qty: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-brand bg-white p-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-text">{item.name}</p>
        <p className="text-sm text-text-soft">Rs {Number(item.price).toFixed(0)}</p>
      </div>
      {qty === 0 ? (
        <button onClick={onAdd} className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white active:scale-95">
          Add
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-3 rounded-full bg-muted px-1">
          <button onClick={() => onSetQty(qty - 1)} className="h-8 w-8 rounded-full text-lg font-semibold text-primary-dark active:scale-90" aria-label={`Remove one ${item.name}`}>
            −
          </button>
          <span className="w-4 text-center text-sm font-semibold text-text">{qty}</span>
          <button onClick={() => onSetQty(qty + 1)} className="h-8 w-8 rounded-full text-lg font-semibold text-primary-dark active:scale-90" aria-label={`Add one more ${item.name}`}>
            +
          </button>
        </div>
      )}
    </div>
  );
}
