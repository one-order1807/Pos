# ONE-ORDER backend - infrastructure scaffold (Phase 2, not started yet)

**Status: scaffolding only.** Nothing in this directory is wired to the ONE-ORDER app yet, and
nothing here is deployed anywhere yet. The app (`oneorder/`) still runs entirely on local SQLite
plus its existing optional Firebase/Firestore sync (`oneorder/src/sync/`) - this directory is the
skeleton the *next* phase of work gets built on top of, when that's actually started: a real
Python API, Postgres as the central database, and Redis for caching/background jobs, eventually
**replacing** Firebase sync (per the confirmed direction - not running alongside it).

What exists here: a working `docker compose up` that boots five containers and proves they can
all talk to each other (the `api` container's `/health` endpoint checks Postgres and Redis
connectivity for real). What does **not** exist yet: any real database schema, any real API
endpoint (waiter login, order sync, kitchen/ticket status...), any real background job, and any
actual deployment to a server. Treat every Python file here as a starting point, not a design.

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

## Database migrations (Alembic)

The scaffold is wired up (`api/alembic.ini`, `api/migrations/`) but **no migrations exist yet**
(`api/migrations/versions/` is empty) because no real schema has been designed yet. Once there are
SQLAlchemy models to migrate:

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

- No real endpoints (auth, order sync, kitchen status, idempotent writes, sync checkpoints) - the
  actual Phase 2 design and build is separate, later work.
- No deployment automation (no CI job pushes this anywhere, unlike `oneorder`'s Android build).
- No multi-tenant schema design yet - worth deciding deliberately once there's a real schema to
  decide it for, not guessed at in a scaffold.
- No TLS/reverse proxy in front of `api` - add one (Caddy/nginx/Traefik) before this ever faces
  the public internet.
