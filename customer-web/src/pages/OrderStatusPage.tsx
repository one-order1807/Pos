import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, getOrderStatus, type OrderStatus } from '../api';

const POLL_MS = 5000;

/** Standalone status lookup by order id alone (no table token needed) - mainly useful as a
 * bookmarkable/shareable link; the primary post-checkout experience is the inline confirmation
 * on OrderPage itself, which also polls this same endpoint. */
export function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    async function poll() {
      try {
        const s = await getOrderStatus(orderId!);
        if (!cancelled) {
          setStatus(s);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not check your order status.');
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !status ? (
        <p className="text-sm text-text-soft">Checking your order...</p>
      ) : (
        <>
          <div className="text-5xl">{status.status === 'mirrored' ? '👨‍🍳' : '✅'}</div>
          <h1 className="text-2xl font-semibold text-text">Order #{status.order_no}</h1>
          <p className="text-sm text-text-soft">{status.table_label}</p>
          <p className="max-w-xs text-base font-medium text-primary-dark">
            {status.status === 'mirrored' ? 'Your order is with the kitchen!' : 'Order confirmed - sending it to the kitchen...'}
          </p>
        </>
      )}
    </div>
  );
}
