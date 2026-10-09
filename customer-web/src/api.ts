// Same-origin by default ("/api") - in production this is served behind the same Caddy that
// serves this site, which strips the /api prefix and forwards to the FastAPI container (see
// backend/Caddyfile). That means no hardcoded domain ever ships in this build, and no CORS setup
// is needed. Local dev points straight at a locally-run backend instead (see .env.development).
const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError((body && body.detail) || `Something went wrong (${res.status}).`, res.status);
  }
  return (await res.json()) as T;
}

export interface MenuCategory {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  price: string;
}

export interface TableInfo {
  org_name: string;
  table_label: string;
  categories: MenuCategory[];
  items: MenuItem[];
}

export function getTableInfo(token: string): Promise<TableInfo> {
  return request<TableInfo>(`/t/${encodeURIComponent(token)}`);
}

export interface OrderLineRequest {
  item_id: string;
  qty: number;
  note?: string;
}

export interface CreateOrderResponse {
  order_id: string;
  order_no: number;
  status: string;
}

export function placeOrder(token: string, idempotencyKey: string, lines: OrderLineRequest[]): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify({ token, idempotency_key: idempotencyKey, lines }),
  });
}

export interface OrderStatus {
  order_id: string;
  order_no: number;
  status: string;
  table_label: string;
}

export function getOrderStatus(orderId: string): Promise<OrderStatus> {
  return request<OrderStatus>(`/orders/${encodeURIComponent(orderId)}`);
}
