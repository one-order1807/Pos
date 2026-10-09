# ONE-ORDER backend

**Status: multi-tenant activation/licensing and QR table ordering are real and working; the
broader order/menu sync for the admin app itself is still a scaffold.** The app (`oneorder/`)
still runs its own menu/table editing, settings, and waiter accounts entirely on local SQLite plus
its existing optional Firebase/Firestore sync (`oneorder/src/sync/`) - that part is untouched and
is the skeleton a *later* phase builds on, eventually **replacing** Firebase sync (not running
alongside it).

What's real: a `docker compose up --build` that boots six containers and proves they can all talk
to each other (`/health` checks Postgres and Redis connectivity for real); a multi-tenant schema
(`organizations` / `devices` / `activation_keys` - see "Multi-tenancy" below) with an Alembic
migration that creates it; a working first-launch device activation flow (`POST /activate`,
`gen_key.py`) that the mobile app actually calls; and QR table ordering end to end - table/menu
sync from Dev Mode, QR token mint/revoke/regenerate, public order intake with server-side price
validation and idempotency, a job that mirrors a confirmed order into the exact Firestore
documents the app already listens to (so it shows up in Chef/Admin with zero app-side sync
changes - see `app/firestore_mirror.py`), a reconciliation sweep for outages, and Caddy serving
`../customer-web`'s build plus reverse-proxying `/api/*` to this api container on one origin (see
`Caddyfile`). What does **not** exist yet: the broader Phase 2 endpoints for the admin app itself
(waiter login/sync, kitchen/ticket status), live "Preparing/Ready" push to the customer page (it
polls `GET /orders/{id}`, which only distinguishes "received" from "with the kitchen" - a
deliberate v1 cut), and any real deployment to a server.

## Containers, and why each one exists

| Container   | Image / build      | Use case |
|-------------|---------------------|----------|
| `postgres`  | `postgres:16-alpine` | The central database once this replaces Firebase - the single source of truth for orders, waiters, menus, etc. across every device, instead of each tablet's own SQLite file. |
| `redis`     | `redis:7-alpine`     | Two jobs in one process: a cache (so the `api` container isn't hitting Postgres for data that barely changes) and the broker the `worker` container consumes jobs from. |
| `api`       | `./api` (FastAPI)    | The one container the mobile app would eventually talk to directly. Stateless - all real state lives in Postgres/Redis - so it can be restarted or scaled out without losing anything. |
| `worker`    | `./api` (same image, different command - `rq worker`) | Runs background jobs the `api` container enqueues instead of handling them inline, so a slow task (e.g. sending a push notification, building a report) never makes a waiter's phone wait on an HTTP response. This is the **real-time-safe** background path - order sync, kitchen notifications, and other operational updates belong here, not in `scheduler`. |
| `scheduler` | `./api` (same image, different command - `scheduler.py`) | Runs the low-traffic-hours jobs (reconciliation, reporting, archival - see the original spec's "10 PM-12 AM" window) plus one much more frequent exception: `reconcile_stuck_orders` every 5 minutes, which re-enqueues any QR order stuck in `received`/`mirror_failed` after a real outage - a waiting customer can't wait for the 10 PM window. Kept in a separate container so a slow nightly job can never contend with or delay real-time traffic on `worker`. |
| `caddy`     | `../` (multi-stage - see `Dockerfile.caddy`) | Reverse proxy + static host + automatic HTTPS, fronting both `api` and `../customer-web`'s build on one origin (`/api/*` vs everything else - see `Caddyfile`). The only container with ports published to the public internet (80/443); everything else stays on the internal compose network. |

`worker` and `scheduler` intentionally share `api`'s Docker image (same `Dockerfile`, different
`command:` in `docker-compose.yml`) rather than each getting their own near-identical Dockerfile -
one image to build and keep dependencies in sync for all three Python processes.

## Running it locally

```sh
cd backend
cp .env.example .env    # then edit POSTGRES_PASSWORD at minimum
docker compose up --build
curl http://localhost:8000/health
# {"status":"ok","postgres":true,"redis":true}
```

`--build` also builds `customer-web` (Node, inside `Dockerfile.caddy`'s first stage) - no separate
build step. With `PUBLIC_BASE_URL` unset (the local-dev default), Caddy serves everything over
plain `http://localhost` with its own locally-trusted dev cert, no real ACME attempt. Open
`http://localhost/t/<token>` once you have a real token (mint one via the app's Dev Mode -> QR
Code Management, pointed at this local backend, or read one straight out of the `qr_tables`
table).

## Deploying to a server

```sh
scp -r backend/ user@server:/opt/oneorder-backend   # or git clone/pull on the server instead
ssh user@server
cd /opt/oneorder-backend
./deploy.sh
```

`deploy.sh` builds the `api` image, brings up the full compose stack, applies any pending Alembic
migrations, and curls `/health` to confirm it came up. It creates `.env` from `.env.example` on
first run if one doesn't exist yet - edit it (`POSTGRES_PASSWORD` at minimum) before trusting that
first deploy. Re-running it later (e.g. after `git pull`) is safe: compose only recreates
containers whose image/config actually changed, and `alembic upgrade head` is a no-op once already
at head. This is a manual script, not CI automation - nothing currently pushes this anywhere
automatically (unlike `oneorder`'s Android build).

## Multi-tenancy

One shared Postgres instance serves every client ("org" - one hotel/restaurant). Isolation is by
row, not by database or schema: every table that matters (`devices`, `activation_keys`, and every
real business table added later) has an `org_id` column. What keeps one client's data from ever
leaking into another's is that **each client gets its own deployment** of this `api`/`worker`/
`scheduler` image (its own container, its own domain) - and that deployment's `ORG_ID`/`ORG_NAME`
come from its own `.env` (see `.env.example`), never from anything a request sends. Every row a
deployment writes is stamped with its own `ORG_ID` server-side; a compromised or misconfigured
client app literally cannot address another org's rows, because the queries that would do that
don't exist on that deployment. Onboarding a new client is: copy `.env.example`, pick a unique
`ORG_ID`, stand up a new deployment pointed at the same Postgres - no schema or code change needed.

The one deliberate crack in that wall is `/admin/orgs` and `/admin/orgs/{org_id}/devices`, which
query across every org in the shared database - meant for your own visibility into all clients
(version, device count, etc.), not for any client app. They 403 unconditionally unless `ADMIN_TOKEN`
is set (see `.env.example`); **only set it on a deployment no client app ever points at.**

## Device activation (first-launch access key)

The app's first launch shows a branded splash, then (if this device hasn't activated yet) an
"Access key" screen. The flow:

1. On the server, generate a code for the client you're activating a device for:
   ```sh
   docker compose run --rm api python gen_key.py          # 10-minute default
   docker compose run --rm api python gen_key.py 300       # custom TTL, in seconds
   ```
   This prints a 10-character code (letters/digits/symbols, no ambiguous characters) and its
   expiry. Read/send it to whoever is installing the app.
2. They type it into the app within the printed window. The app calls `POST /activate` with the
   code plus a random device id it generates once and stores locally.
3. The server checks the code against this deployment's `ORG_ID` only, rejects it if it's expired
   or already used, marks it used, and returns a per-device token the app stores locally. The code
   can never be redeemed a second time, by anyone, even if it was overheard or screenshotted.

Codes are stored as a SHA-256 hash only (`app/security.py`) - a database dump alone can never hand
out a currently-valid code. This only works if the device has network access to this deployment's
domain the moment the key is entered (see the project's earlier decision on this) - there's no
offline fallback.

## Database migrations (Alembic)

`api/migrations/versions/0001_initial_schema.py` creates `organizations`/`devices`/
`activation_keys`. It was **hand-written, not autogenerated** - there was no live Postgres
available to diff against models.py when it was authored, so run it and confirm it applies cleanly
before trusting it in production:

```sh
docker compose run --rm api alembic upgrade head
```

For any later schema change, autogenerate against `app/models.py` as usual:

```sh
docker compose run --rm api alembic revision --autogenerate -m "describe the change"
docker compose run --rm api alembic upgrade head
```

`6ae0e2e8214b_qr_tables_menu_mirror_orders.py` (the QR/menu/order tables) followed exactly this
path - autogenerated and applied against a real database as part of building it, not hand-written.

`migrations/env.py` reads `DATABASE_URL` from the same environment variable the `api`/`worker`/
`scheduler` containers already use - never a hardcoded connection string in a committed file.

## Sizing (2-core / 4GB server, with an upgrade path)

Current per-container limits in `docker-compose.yml` total roughly **2.35 CPU / 2.3GB**, leaving
headroom on a 2-core/4GB box for the OS and Docker itself:

- `postgres`: 1.0 CPU, 1024MB limit (512MB reservation) - the one service worth protecting first
  if the box is under memory pressure, since losing Postgres means losing everything.
- `redis`: 0.25 CPU, 256MB (capped with `maxmemory 200mb` + `allkeys-lru`, so it can never grow
  past that and start competing with Postgres for RAM under load).
- `api`: 0.5 CPU, 512MB.
- `worker`: 0.25 CPU, 256MB.
- `scheduler`: 0.1 CPU, 128MB - it does almost nothing most of the day.
- `caddy`: 0.25 CPU, 128MB - a reverse proxy plus serving an already-built static site is cheap;
  it never runs Node at request time, only during the image build.

**Upgrade path, roughly in order of when you'd actually need it:**
1. Raise `postgres`'s limit first (and give the server more RAM) - it's almost always the first
   thing to run out of headroom as order history grows, well before CPU becomes the bottleneck.
2. Add a `worker` replica (`docker compose up --scale worker=2`) once background jobs start
   queueing up visibly, rather than raising its CPU limit - `rq` workers are designed to run
   several at once against the same queue.
3. Move `postgres` to its own machine/managed database only once a single box genuinely can't
   keep up - there's no reason to do this preemptively for a small client.

## What's deliberately NOT here

- No order/menu sync endpoints for the *admin app's own* data (waiter login/sync, kitchen/ticket
  status) - that's the actual Phase 2 design and build, separate from QR ordering, still later
  work. Device activation/licensing and QR table ordering are the two parts of this backend that
  are real so far.
- No live "Preparing/Ready" push to the customer-web page - it polls `GET /orders/{id}`, which
  only ever reports "received" or "with the kitchen" (mirrored). The full version would need a
  Firestore-change listener bridged over a WebSocket to the browser; cut from v1 as the most
  complex, least load-bearing piece - add it as a fast-follow if customers need finer-grained
  status than that.
- No restaurant logo/branding image on the customer-web landing page - it shows the restaurant's
  name only (`org_name`); threading the app's own bill logo through would need a new migration
  and an RN-side raster-to-base64 step, cut from v1 as cosmetic rather than functional.
- No deployment automation (no CI job pushes this anywhere, unlike `oneorder`'s Android build) -
  `deploy.sh` is a manual script you run yourself per deployment.
- No seat-count enforcement yet - `organizations.max_devices` exists in the schema but nothing
  reads it; add that check to `/activate` once you actually want to cap devices per client.
- No super-admin UI - `/admin/orgs` and `/admin/orgs/{org_id}/devices` are API-only by design for
  now (confirmed direction - a dashboard UI is a separate, later build on top of these).
- No per-table-QR rate limiting on `POST /orders` - fine for a single café's traffic, worth adding
  (e.g. at the Caddy layer) before this is exposed to a much larger audience.
