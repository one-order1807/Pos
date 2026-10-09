# ONE-ORDER customer ordering site

A static React SPA a customer lands on after scanning a table's QR code (see
`oneorder/src/screens/QrManagementScreen.tsx`, Dev Mode -> QR Code Management). Browses the menu,
builds a cart, places an order - the table is identified entirely from the scanned link's token,
never typed or chosen by the customer.

## How it talks to the backend

Same-origin, relative `/api/...` calls (see `src/api.ts`) - in production this site and the
`backend/api` FastAPI container sit behind the same Caddy, which strips the `/api` prefix and
forwards to `api:8000` (see `backend/Caddyfile`). No domain is ever hardcoded into this build, and
there's no CORS to configure, because the browser only ever sees one origin.

## Local development

```sh
npm install
npm run dev
```

`.env.development` points `VITE_API_BASE` at `http://localhost:8000` instead, since there's no
Caddy running locally - run the backend separately first:

```sh
cd ../backend && docker compose up --build
```

Open `http://localhost:5173/t/<a token from /tables/sync>` - a real token comes from either the
app's QR Management screen (against this same local backend) or a row in the `qr_tables` table.

## Build

```sh
npm run build   # tsc -b && vite build -> dist/
```

`dist/` is a plain static site - no Node server needed to serve it in production, just a static
file server (Caddy; see `backend/docker-compose.yml`).

## What this deliberately does not do

- No login/account creation - the table token is the only "identity" a customer needs.
- No payment collection - billing stays entirely in the existing POS/admin app workflow (the order
  shows up there like any other dine-in order); this site's job ends at order submission.
- No offline support beyond the cart itself persisting in `localStorage` per table token
  (`src/cart.ts`) - placing an order always needs a live connection to the backend.
