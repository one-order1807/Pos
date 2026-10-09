import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, getOrderStatus, getTableInfo, placeOrder, type CreateOrderResponse, type TableInfo } from '../api';
import { CartSheet } from '../components/CartSheet';
import { MenuBrowser } from '../components/MenuBrowser';
import { useCart } from '../cart';

type Step = 'loading' | 'error' | 'landing' | 'menu' | 'confirmed';

export function OrderPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [error, setError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<CreateOrderResponse | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const cart = useCart(token);

  useEffect(() => {
    let cancelled = false;
    setStep('loading');
    getTableInfo(token)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setStep(cart.lines.length > 0 ? 'menu' : 'landing');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "This QR code isn't valid anymore. Please ask staff for help.");
        setStep('error');
      });
    return () => {
      cancelled = true;
    };
    // cart.lines is only read for its length on the very first load of this token, deliberately
    // not re-run as the cart changes afterwards - this effect's job is the one-time table lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handlePlaceOrder() {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setPlacing(true);
    setPlaceError('');
    try {
      const res = await placeOrder(
        token,
        idempotencyKeyRef.current,
        cart.lines.map((l) => ({ item_id: l.itemId, qty: l.qty, note: l.note })),
      );
      idempotencyKeyRef.current = null; // next order (if any) gets its own fresh key
      cart.clear();
      setCartOpen(false);
      setConfirmedOrder(res);
      setStep('confirmed');
    } catch (e) {
      // Deliberately keep idempotencyKeyRef as-is - a retry of the exact same attempt must reuse
      // it, so a response that was lost in transit (but still landed server-side) doesn't create
      // a second order.
      setPlaceError(e instanceof ApiError ? e.message : 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  }

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-text-soft">Loading menu...</p>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl">⚠️</div>
        <p className="max-w-sm text-base font-medium text-text">{error}</p>
      </div>
    );
  }

  if (!info) return null;

  if (step === 'landing') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div className="text-5xl">🍽️</div>
        <h1 className="text-3xl font-semibold text-text">{info.org_name}</h1>
        <p className="text-base text-text-soft">{info.table_label}</p>
        <button
          onClick={() => setStep('menu')}
          className="mt-4 rounded-full bg-primary px-8 py-3 text-base font-semibold text-white shadow-lg active:scale-95"
        >
          Start Ordering
        </button>
      </motion.div>
    );
  }

  if (step === 'confirmed' && confirmedOrder) {
    return <ConfirmedView order={confirmedOrder} tableLabel={info.table_label} onOrderMore={() => setStep('menu')} />;
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-4 pt-5">
        <p className="text-sm text-text-soft">{info.table_label}</p>
        <h1 className="text-2xl font-semibold text-text">{info.org_name}</h1>
      </header>
      <MenuBrowser categories={info.categories} items={info.items} cartLines={cart.lines} onAdd={(id) => cart.addItem(id)} onSetQty={cart.setQty} />

      {cart.totalQty > 0 && !cartOpen ? (
        <motion.button
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-brand bg-primary px-5 py-3.5 text-white shadow-xl"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span className="font-semibold">{cart.totalQty} item{cart.totalQty === 1 ? '' : 's'}</span>
          <span className="font-semibold">View cart</span>
        </motion.button>
      ) : null}

      <AnimatePresence>
        {cartOpen ? (
          <CartSheet
            items={info.items}
            lines={cart.lines}
            onSetQty={cart.setQty}
            onClose={() => setCartOpen(false)}
            onPlaceOrder={handlePlaceOrder}
            placing={placing}
            placeError={placeError}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ConfirmedView({ order, tableLabel, onOrderMore }: { order: CreateOrderResponse; tableLabel: string; onOrderMore: () => void }) {
  const [status, setStatus] = useState(order.status);

  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      getOrderStatus(order.order_id)
        .then((s) => {
          if (!cancelled) setStatus(s.status);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [order.order_id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <div className="text-5xl">{status === 'mirrored' ? '👨‍🍳' : '✅'}</div>
      <h1 className="text-2xl font-semibold text-text">Order #{order.order_no} placed!</h1>
      <p className="text-sm text-text-soft">{tableLabel}</p>
      <p className="max-w-xs text-base font-medium text-primary-dark">
        {status === 'mirrored' ? 'Your order is with the kitchen!' : 'Sending your order to the kitchen...'}
      </p>
      <button onClick={onOrderMore} className="mt-6 rounded-full border border-primary px-6 py-2.5 text-sm font-semibold text-primary active:scale-95">
        Order more
      </button>
    </motion.div>
  );
}
