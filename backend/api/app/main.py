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
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from rq import Retry
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import SessionLocal, engine
from .firestore_mirror import mirror_order
from .models import ActivationKey, Device, MenuCategoryMirror, MenuItemMirror, Order, OrderLine, Organization, QrTable
from .queue import queue as _queue
from .queue import redis_client as _redis
from .security import constant_time_eq, generate_device_token, hash_code, hash_token

app = FastAPI(title="ONE-ORDER API")

ORG_ID = os.environ["ORG_ID"]
ORG_NAME = os.environ.get("ORG_NAME", ORG_ID)
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN")
# This deployment's own public URL (e.g. "https://cafe-aroma.oneorder.co.in") - used only to build
# full, scannable QR links. Left unset in local dev, where /tables/sync still returns a working
# relative "/t/{token}" path.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_device(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Device:
    """
    Authenticates an already-activated admin/waiter app device (see /activate above) for the
    endpoints only that app should call - minting/rotating table QR tokens, pushing a menu
    snapshot. Deliberately NOT used on the customer-facing endpoints below (GET /t/{token},
    POST /orders) - a customer's phone was never activated and never will be.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing device token.")
    token = authorization.split(" ", 1)[1].strip()
    device = db.scalar(select(Device).where(Device.token_hash == hash_token(token), Device.org_id == ORG_ID))
    if device is None or not device.is_active:
        raise HTTPException(status_code=401, detail="Invalid or deactivated device token.")
    device.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return device


def _table_url(token: str) -> str:
    return f"{PUBLIC_BASE_URL}/t/{token}" if PUBLIC_BASE_URL else f"/t/{token}"


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


# ---------------------------------------------------------------------------
# QR table management (Dev Mode -> here, authenticated via require_device)
# ---------------------------------------------------------------------------


class TableSyncItem(BaseModel):
    id: str
    label: str


class TableSyncRequest(BaseModel):
    tables: list[TableSyncItem]
    # True (the default) means "this is every table the app currently has" - anything active in
    # our records but missing from the list gets its QR revoked. The app always sends the full
    # list (it has nothing else to send), so this exists mainly so a future partial-update caller
    # doesn't have to reason about accidentally revoking everything else.
    full_sync: bool = True


class TableSyncResultItem(BaseModel):
    table_local_id: str
    label: str
    token: str
    url: str
    status: str


def _qr_result(row: QrTable) -> TableSyncResultItem:
    return TableSyncResultItem(table_local_id=row.table_local_id, label=row.label, token=row.token, url=_table_url(row.token), status=row.status)


@app.post("/tables/sync", response_model=list[TableSyncResultItem])
def sync_tables(req: TableSyncRequest, db: Session = Depends(get_db), _device: Device = Depends(require_device)):
    """
    Called whenever Dev Mode's QR Management screen opens and whenever a table is added/deleted -
    mints a token for any table that doesn't have an active one yet, leaves existing ones alone
    (regenerating is a separate, explicit action - see /tables/{id}/qr/regenerate), and revokes
    tokens for tables no longer in the list. This is what makes QR management "dynamic" per the
    spec without the app needing to know anything about tokens itself.
    """
    rows: list[QrTable] = []
    for t in req.tables:
        active = db.scalar(select(QrTable).where(QrTable.org_id == ORG_ID, QrTable.table_local_id == t.id, QrTable.status == "active"))
        if active is None:
            active = QrTable(org_id=ORG_ID, table_local_id=t.id, label=t.label, token=generate_device_token())
            db.add(active)
        elif active.label != t.label:
            active.label = t.label
        rows.append(active)

    if req.full_sync:
        seen_ids = {t.id for t in req.tables}
        stale = db.scalars(
            select(QrTable).where(QrTable.org_id == ORG_ID, QrTable.status == "active", QrTable.table_local_id.notin_(seen_ids))
        ).all()
        now = datetime.now(timezone.utc)
        for row in stale:
            row.status = "revoked"
            row.revoked_at = now

    db.commit()
    return [_qr_result(r) for r in rows]


@app.post("/tables/{table_local_id}/qr/regenerate", response_model=TableSyncResultItem)
def regenerate_table_qr(table_local_id: str, db: Session = Depends(get_db), _device: Device = Depends(require_device)):
    active = db.scalar(select(QrTable).where(QrTable.org_id == ORG_ID, QrTable.table_local_id == table_local_id, QrTable.status == "active"))
    if active is None:
        raise HTTPException(status_code=404, detail="No active QR code for this table - open QR Management to generate one first.")
    active.status = "revoked"
    active.revoked_at = datetime.now(timezone.utc)
    fresh = QrTable(org_id=ORG_ID, table_local_id=table_local_id, label=active.label, token=generate_device_token())
    db.add(fresh)
    db.commit()
    return _qr_result(fresh)


class MenuCategorySync(BaseModel):
    id: str
    name: str
    sort: int = 0


class MenuItemSync(BaseModel):
    id: str
    category_id: str
    name: str
    price: Decimal
    active: bool = True


class MenuSyncRequest(BaseModel):
    categories: list[MenuCategorySync]
    items: list[MenuItemSync]


@app.post("/menu/sync")
def sync_menu(req: MenuSyncRequest, db: Session = Depends(get_db), _device: Device = Depends(require_device)):
    """
    A one-way mirror of the app's own menu into Postgres, purely so the customer-facing endpoints
    below have something to read and validate orders against. This backend never edits the menu -
    the app stays the one place categories/items are authored; call this after any menu edit and
    whenever QR Management opens, same as /tables/sync.
    """
    now = datetime.now(timezone.utc)
    for c in req.categories:
        row = db.scalar(select(MenuCategoryMirror).where(MenuCategoryMirror.org_id == ORG_ID, MenuCategoryMirror.local_id == c.id))
        if row is None:
            db.add(MenuCategoryMirror(org_id=ORG_ID, local_id=c.id, name=c.name, sort=c.sort, updated_at=now))
        else:
            row.name, row.sort, row.updated_at = c.name, c.sort, now

    seen_item_ids = {i.id for i in req.items}
    for i in req.items:
        row = db.scalar(select(MenuItemMirror).where(MenuItemMirror.org_id == ORG_ID, MenuItemMirror.local_id == i.id))
        if row is None:
            db.add(MenuItemMirror(org_id=ORG_ID, local_id=i.id, category_local_id=i.category_id, name=i.name, price=i.price, active=i.active, updated_at=now))
        else:
            row.category_local_id, row.name, row.price, row.active, row.updated_at = i.category_id, i.name, i.price, i.active, now

    # Items missing from this sync no longer exist in the app - marked inactive rather than
    # deleted, so an order already placed against one still resolves correctly in its own history.
    stale_items = db.scalars(
        select(MenuItemMirror).where(MenuItemMirror.org_id == ORG_ID, MenuItemMirror.active.is_(True), MenuItemMirror.local_id.notin_(seen_item_ids))
    ).all()
    for row in stale_items:
        row.active = False
        row.updated_at = now

    db.commit()
    return {"status": "ok", "categories": len(req.categories), "items": len(req.items)}


# ---------------------------------------------------------------------------
# Customer-facing ordering (public - no device auth; a table *token* is the only credential)
# ---------------------------------------------------------------------------


class PublicMenuCategory(BaseModel):
    id: str
    name: str
    sort: int


class PublicMenuItem(BaseModel):
    id: str
    category_id: str
    name: str
    price: Decimal


class TableInfoResponse(BaseModel):
    org_name: str
    table_label: str
    categories: list[PublicMenuCategory]
    items: list[PublicMenuItem]


def _resolve_active_table(token: str, db: Session) -> QrTable:
    qr_table = db.scalar(select(QrTable).where(QrTable.token == token, QrTable.org_id == ORG_ID))
    if qr_table is None or qr_table.status != "active":
        # Same message either way (unknown vs. revoked token) - confirming a token *used to* exist
        # would leak information to anyone guessing links, for no customer-facing benefit.
        raise HTTPException(status_code=404, detail="This QR code isn't valid anymore. Please ask staff for a fresh one.")
    return qr_table


@app.get("/t/{token}", response_model=TableInfoResponse)
def get_table_info(token: str, db: Session = Depends(get_db)):
    qr_table = _resolve_active_table(token, db)
    categories = db.scalars(select(MenuCategoryMirror).where(MenuCategoryMirror.org_id == ORG_ID).order_by(MenuCategoryMirror.sort)).all()
    items = db.scalars(select(MenuItemMirror).where(MenuItemMirror.org_id == ORG_ID, MenuItemMirror.active.is_(True))).all()
    return TableInfoResponse(
        org_name=ORG_NAME,
        table_label=qr_table.label,
        categories=[PublicMenuCategory(id=c.local_id, name=c.name, sort=c.sort) for c in categories],
        items=[PublicMenuItem(id=i.local_id, category_id=i.category_local_id, name=i.name, price=i.price) for i in items],
    )


class OrderLineRequest(BaseModel):
    item_id: str
    qty: int
    note: str = ""


class CreateOrderRequest(BaseModel):
    token: str
    idempotency_key: str
    lines: list[OrderLineRequest]


class CreateOrderResponse(BaseModel):
    order_id: str
    order_no: int
    status: str


# QR orders get their own day-scoped counter (see QrOrderCounter/Order.order_no's docstrings in
# models.py) offset well clear of the app's own Settings.orderCounter range, so this backend never
# has to write to that Firestore-synced document itself and race the app's own devices for it.
_QR_ORDER_NO_OFFSET = 5000


def _next_qr_order_no(db: Session, day: str) -> int:
    n = db.execute(
        text(
            "INSERT INTO qr_order_counters (org_id, day, n) VALUES (:org, :day, 1) "
            "ON CONFLICT (org_id, day) DO UPDATE SET n = qr_order_counters.n + 1 "
            "RETURNING n"
        ),
        {"org": ORG_ID, "day": day},
    ).scalar_one()
    return _QR_ORDER_NO_OFFSET + n


@app.post("/orders", response_model=CreateOrderResponse)
def create_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    existing = db.scalar(select(Order).where(Order.org_id == ORG_ID, Order.idempotency_key == req.idempotency_key))
    if existing is not None:
        # A retried submit (network blip, double-tap) - return the order already created instead
        # of making another one. See the IntegrityError handling below for the race version of
        # this same check.
        return CreateOrderResponse(order_id=existing.id, order_no=existing.order_no, status=existing.status)

    if not req.lines:
        raise HTTPException(status_code=400, detail="Your cart is empty.")

    qr_table = _resolve_active_table(req.token, db)

    lines: list[OrderLine] = []
    subtotal = Decimal("0.00")
    for line in req.lines:
        if line.qty <= 0 or line.qty > 50:
            raise HTTPException(status_code=400, detail="Quantity must be between 1 and 50.")
        item = db.scalar(
            select(MenuItemMirror).where(MenuItemMirror.org_id == ORG_ID, MenuItemMirror.local_id == line.item_id, MenuItemMirror.active.is_(True))
        )
        if item is None:
            raise HTTPException(status_code=400, detail=f'"{line.item_id}" is no longer available - please refresh the menu.')
        subtotal += item.price * line.qty
        lines.append(OrderLine(menu_item_local_id=item.local_id, name=item.name, unit_price=item.price, qty=line.qty, note=line.note[:200]))

    order = Order(
        id=str(uuid.uuid4()),
        org_id=ORG_ID,
        qr_table_id=qr_table.id,
        table_local_id=qr_table.table_local_id,
        table_label=qr_table.label,
        idempotency_key=req.idempotency_key,
        order_no=_next_qr_order_no(db, datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        subtotal=subtotal,
    )
    for line in lines:
        line.order_id = order.id
    db.add(order)
    db.add_all(lines)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race against another request with the same idempotency_key - fetch and return
        # whichever one actually landed, rather than erroring a legitimate retry.
        db.rollback()
        existing = db.scalar(select(Order).where(Order.org_id == ORG_ID, Order.idempotency_key == req.idempotency_key))
        if existing is None:
            raise
        return CreateOrderResponse(order_id=existing.id, order_no=existing.order_no, status=existing.status)

    # The order is already safely committed above - a customer must never see a failure here, so
    # a Redis outage at this exact moment doesn't become a 500 for an order that actually went
    # through. reconcile_stuck_orders (firestore_mirror.py, run every few minutes from
    # scheduler.py) picks up anything that fails to enqueue, same as it does for any other stuck
    # 'received' order.
    try:
        _queue.enqueue(mirror_order, order.id, retry=Retry(max=5, interval=[5, 15, 30, 60, 120]))
    except Exception:
        logging.getLogger("main").exception("create_order: failed to enqueue mirror job for order %s - reconcile sweep will retry", order.id)
    return CreateOrderResponse(order_id=order.id, order_no=order.order_no, status=order.status)


@app.get("/orders/{order_id}")
def get_order_status(order_id: str, db: Session = Depends(get_db)):
    order = db.scalar(select(Order).where(Order.id == order_id, Order.org_id == ORG_ID))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    return {"order_id": order.id, "order_no": order.order_no, "status": order.status, "table_label": order.table_label}


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
