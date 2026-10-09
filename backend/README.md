# ONE-ORDER backend

**Status: multi-tenant activation/licensing is real and working; order/menu sync is still a
scaffold.** The app (`oneorder/`) still runs its actual order/menu/table data entirely on local
SQLite plus its existing optional Firebase/Firestore sync (`oneorder/src/sync/`) - that part of
this backend is still the skeleton a *later* phase builds on, eventually **replacing** Firebase
sync (not running alongside it).

What's real: a `docker compose up` that boots five containers and proves they can all talk to
each other (`/health` checks Postgres and Redis connectivity for real); a multi-tenant schema
(`organizations` / `devices` / `activation_keys` - see "Multi-tenancy" below) with an Alembic
migration that creates it; and a working first-launch device activation flow (`POST /activate`,
`gen_key.py`) that the mobile app actually calls. What does **not** exist yet: real order/menu
sync endpoints (waiter login, order sync, kitchen/ticket status...), any real background job
logic, and TLS/a reverse proxy in front of `api`.

## Containers, and why each one exists

| Container   | Image / build      | Use case |
|-------------|---------------------|----------|
| `postgres`  | `postgres:16-alpine` | The central database once this replaces Firebase - the single source of truth for orders, waiters, menus, etc. across every device, instead of each tablet's own SQLite file. |
| `redis`     | `redis:7-alpine`     | Two jobs in one process: a cache (so the `api` container isn't hitting Postgres for data that barely changes) and the broker the `worker` container consumes jobs from. |
| `api`       | `./api` (FastAPI)    | The one container the mobile app would eventually talk to directly. Stateless - all real state lives in Postgres/Redis - so it can be restarted or scaled out without losing anything. |
| `worker`    | `./api` (same image, different command - `rq worker`) | Runs background jobs the `api` container enqueues instead of handling them inline, so a slow task (e.g. sending a push notification, building a report) never makes a waiter's phone wait on an HTTP response. This is the **real-time-safe** background path - order sync, kitchen notifications, and other operational updates belong here, not in `scheduler`. |
| `scheduler` | `./api` (same image, different command - `scheduler.py`) | Runs ONLY the low-traffic-hours jobs (reconciliation, reporting, archival - see the original spec's "10 PM-12 AM" window), kept in a separate container specifically so a slow nightly job can never contend with or delay real-time traffic on `worker`. Currently just a placeholder schedule with a no-op job (`api/scheduler.py`) - no real reconciliation logic exists yet. |

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

`migrations/env.py` reads `DATABASE_URL` from the same environment variable the `api`/`worker`/
`scheduler` containers already use - never a hardcoded connection string in a committed file.

## Sizing (2-core / 4GB server, with an upgrade path)

Current per-container limits in `docker-compose.yml` total roughly **2.1 CPU / 2.2GB**, leaving
headroom on a 2-core/4GB box for the OS and Docker itself:

- `postgres`: 1.0 CPU, 1024MB limit (512MB reservation) - the one service worth protecting first
  if the box is under memory pressure, since losing Postgres means losing everything.
- `redis`: 0.25 CPU, 256MB (capped with `maxmemory 200mb` + `allkeys-lru`, so it can never grow
  past that and start competing with Postgres for RAM under load).
- `api`: 0.5 CPU, 512MB.
- `worker`: 0.25 CPU, 256MB.
- `scheduler`: 0.1 CPU, 128MB - it does almost nothing most of the day.

**Upgrade path, roughly in order of when you'd actually need it:**
1. Raise `postgres`'s limit first (and give the server more RAM) - it's almost always the first
   thing to run out of headroom as order history grows, well before CPU becomes the bottleneck.
2. Add a `worker` replica (`docker compose up --scale worker=2`) once background jobs start
   queueing up visibly, rather than raising its CPU limit - `rq` workers are designed to run
   several at once against the same queue.
3. Move `postgres` to its own machine/managed database only once a single box genuinely can't
   keep up - there's no reason to do this preemptively for a small client.

## What's deliberately NOT here

- No order/menu sync endpoints yet (order sync, kitchen status, idempotent writes, sync
  checkpoints) - the actual Phase 2 design and build for that is separate, later work. Device
  activation/licensing is the one part of Phase 2 that's real so far.
- No deployment automation (no CI job pushes this anywhere, unlike `oneorder`'s Android build) -
  `deploy.sh` is a manual script you run yourself per deployment.
- No seat-count enforcement yet - `organizations.max_devices` exists in the schema but nothing
  reads it; add that check to `/activate` once you actually want to cap devices per client.
- No super-admin UI - `/admin/orgs` and `/admin/orgs/{org_id}/devices` are API-only by design for
  now (confirmed direction - a dashboard UI is a separate, later build on top of these).
- No TLS/reverse proxy in front of `api` - add one (Caddy/nginx/Traefik) before this ever faces
  the public internet. The access-key flow assumes the connection to `api` is already trusted;
  over plain HTTP on the open internet, a code could be intercepted in transit.
