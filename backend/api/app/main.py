"""
ONE-ORDER backend API.

Multi-tenant model: ONE shared Postgres instance serves every client, but each client gets its own
deployment of this API (its own container/domain). A deployment's own org_id/org_name come from
ITS OWN environment (ORG_ID/ORG_NAME - see .env.example), and every row it creates is tagged with
THAT org_id - never one supplied by a request - so a compromised or misconfigured client app can
never read or write another client's data. The one deliberate exception is /admin/*, which sees
across every org in the shared database - see the warning on require_admin() below before ever
setting ADMIN_TOKEN on a deployment a client app can reach.
"""
import os
from datetime import datetime, timezone

import redis
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .db import SessionLocal, engine
from .models import ActivationKey, Device, Organization
from .security import constant_time_eq, generate_device_token, hash_code, hash_token

app = FastAPI(title="ONE-ORDER API")

ORG_ID = os.environ["ORG_ID"]
ORG_NAME = os.environ.get("ORG_NAME", ORG_ID)
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN")

_redis = redis.Redis.from_url(os.environ["REDIS_URL"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def ensure_organization() -> None:
    # Relies on migrations already having run (see deploy.sh / README) - deliberately does NOT
    # create tables itself, so Alembic stays the single source of truth for schema and never
    # drifts out of sync with what's actually in the database.
    with SessionLocal() as db:
        org = db.get(Organization, ORG_ID)
        if org is None:
            db.add(Organization(org_id=ORG_ID, org_name=ORG_NAME))
            db.commit()
        elif org.org_name != ORG_NAME:
            org.org_name = ORG_NAME
            db.commit()


@app.get("/health")
def health():
    checks = {"postgres": False, "redis": False}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:
        pass
    try:
        checks["redis"] = bool(_redis.ping())
    except Exception:
        pass
    return {"status": "ok" if all(checks.values()) else "degraded", **checks}


class ActivateRequest(BaseModel):
    code: str
    device_id: str
    app_variant: str
    app_version: str


class ActivateResponse(BaseModel):
    device_token: str
    org_name: str


@app.post("/activate", response_model=ActivateResponse)
def activate(req: ActivateRequest, db: Session = Depends(get_db)):
    """
    Redeems a one-time, time-limited access key (see gen_key.py) and binds this device to this
    deployment's org. Each key only ever works against the deployment it was generated on (the
    lookup below is scoped to ORG_ID), and only once - `used_at` is set the moment it's redeemed,
    so a key that's been read aloud or had a screenshot taken of it can't be replayed by anyone else.
    """
    key = db.scalar(
        select(ActivationKey).where(ActivationKey.code_hash == hash_code(req.code), ActivationKey.org_id == ORG_ID)
    )
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid access key.")
    now = datetime.now(timezone.utc)
    if key.used_at is not None:
        raise HTTPException(status_code=401, detail="This access key has already been used.")
    if key.expires_at < now:
        raise HTTPException(status_code=401, detail="This access key has expired.")

    token = generate_device_token()
    device = db.scalar(select(Device).where(Device.device_id == req.device_id))
    if device is None:
        device = Device(
            org_id=ORG_ID,
            device_id=req.device_id,
            app_variant=req.app_variant,
            app_version=req.app_version,
            token_hash=hash_token(token),
        )
        db.add(device)
    else:
        device.app_variant = req.app_variant
        device.app_version = req.app_version
        device.token_hash = hash_token(token)
        device.is_active = True
        device.last_seen_at = now
    key.used_at = now
    key.used_by_device_id = req.device_id
    db.commit()
    return ActivateResponse(device_token=token, org_name=ORG_NAME)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    # Fails closed: with no ADMIN_TOKEN set (the default), every /admin/* route 403s unconditionally
    # - so a client-facing deployment is only ever exposed to cross-org data if you deliberately set
    # ADMIN_TOKEN on it, which you should not do. Keep ADMIN_TOKEN set only on a deployment no
    # client app ever points at, reserved for your own operational use.
    if not ADMIN_TOKEN or not x_admin_token or not constant_time_eq(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(status_code=403, detail="Not authorized.")


@app.get("/admin/orgs", dependencies=[Depends(require_admin)])
def list_orgs(db: Session = Depends(get_db)):
    rows = db.execute(
        select(
            Organization.org_id,
            Organization.org_name,
            Organization.is_active,
            Organization.max_devices,
            func.count(Device.id).label("device_count"),
        )
        .outerjoin(Device, Device.org_id == Organization.org_id)
        .group_by(Organization.org_id)
    ).all()
    return [
        {
            "org_id": r.org_id,
            "org_name": r.org_name,
            "is_active": r.is_active,
            "max_devices": r.max_devices,
            "device_count": r.device_count,
        }
        for r in rows
    ]


@app.get("/admin/orgs/{org_id}/devices", dependencies=[Depends(require_admin)])
def list_org_devices(org_id: str, db: Session = Depends(get_db)):
    rows = db.scalars(select(Device).where(Device.org_id == org_id)).all()
    return [
        {
            "device_id": d.device_id,
            "app_variant": d.app_variant,
            "app_version": d.app_version,
            "is_active": d.is_active,
            "activated_at": d.activated_at,
            "last_seen_at": d.last_seen_at,
        }
        for d in rows
    ]
