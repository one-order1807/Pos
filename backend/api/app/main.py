"""
ONE-ORDER backend API - infrastructure scaffold, not a working backend yet.

This is the skeleton Phase 2 (replacing the app's current Firebase sync with this Postgres/Redis/
Python stack - see oneorder/src/sync/ for what it's replacing) gets built on top of. The one real
endpoint here, /health, proves this container can actually reach Postgres and Redis end to end.
Every real endpoint this backend will eventually need - waiter login, order sync, kitchen/ticket
status, idempotent writes with unique order IDs, etc. - is future work, deliberately not started
here so this round stays a scaffold rather than a half-built guess at the real design.
"""

import os

import redis
from fastapi import FastAPI
from sqlalchemy import create_engine, text

app = FastAPI(title="ONE-ORDER API")

_engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
_redis = redis.Redis.from_url(os.environ["REDIS_URL"])


@app.get("/health")
def health():
    checks = {"postgres": False, "redis": False}
    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:
        pass
    try:
        checks["redis"] = bool(_redis.ping())
    except Exception:
        pass
    return {"status": "ok" if all(checks.values()) else "degraded", **checks}
