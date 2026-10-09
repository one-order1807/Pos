"""
Tenant data model.

Every client ("org" - a hotel/restaurant) gets its own deployment of this backend: its own
container and domain, its own ORG_ID/ORG_NAME read from its own .env (see .env.example) - but all
deployments share ONE Postgres instance (see docker-compose.yml). A deployment only ever reads or
writes rows tagged with ITS OWN org_id, which this process reads from its own environment at
startup - never from anything a client app sends over the wire - so one compromised or
misconfigured client app can never see or touch another org's rows. The /admin/* routes in main.py
are the one deliberate exception (see the warning there).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Organization(Base):
    __tablename__ = "organizations"

    org_id: Mapped[str] = mapped_column(String, primary_key=True)
    org_name: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # None = unlimited. Not enforced anywhere yet - a seat-count cap is a deliberate later step
    # once there's a real reason to enforce one, not guessed at here.
    max_devices: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    devices: Mapped[list["Device"]] = relationship(back_populates="organization")
    activation_keys: Mapped[list["ActivationKey"]] = relationship(back_populates="organization")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    # A random id the app generates once on first launch and persists locally (see
    # oneorder/src/activation/activate.ts) - not a hardware identifier, so it survives OS-level
    # privacy restrictions and reinstalling the app just activates again as a "new" device.
    device_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    app_variant: Mapped[str] = mapped_column(String, nullable=False)  # 'admin' | 'waiter'
    app_version: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="devices")


class ActivationKey(Base):
    __tablename__ = "activation_keys"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    # SHA-256 of the code the installer actually types in - never the plaintext code itself, so a
    # database dump alone can never hand out a currently-valid key (see app/security.py).
    code_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    used_by_device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="activation_keys")


class QrTable(Base):
    """
    One row per *generation* of a table's QR code - regenerating or deleting a table never
    mutates a row in place, it revokes the active one and (for regenerate) inserts a new one.
    That keeps old links provably dead (see spec: "deleting a table must invalidate its QR") and
    gives a free history, instead of a single mutable row whose past tokens are lost.
    """

    __tablename__ = "qr_tables"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    # oneorder's own TableDef.id (its local SQLite/Firestore primary key) - never reused as the
    # public QR payload itself, so the token can be rotated without the table's identity changing.
    table_local_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    # The opaque value that actually appears in the QR/URL. Never the table id or row id - see
    # app/security.py's generate_device_token() for the same "unguessable random token" pattern.
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")  # 'active' | 'revoked'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class MenuCategoryMirror(Base):
    """
    A read-only mirror of the app's own Category, pushed by the admin app (POST /menu/sync) purely
    so the public customer-ordering endpoints have something to read - this backend never edits
    the menu itself, the app remains the one place categories/items are authored.
    """

    __tablename__ = "menu_category_mirror"
    __table_args__ = (UniqueConstraint("org_id", "local_id", name="uq_menu_category_org_local"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    local_id: Mapped[str] = mapped_column(String, nullable=False)  # the app's Category.id
    name: Mapped[str] = mapped_column(String, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class MenuItemMirror(Base):
    """Mirror of the app's own MenuItem - see MenuCategoryMirror's docstring."""

    __tablename__ = "menu_item_mirror"
    __table_args__ = (UniqueConstraint("org_id", "local_id", name="uq_menu_item_org_local"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    local_id: Mapped[str] = mapped_column(String, nullable=False)  # the app's MenuItem.id
    category_local_id: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Decimal, not float - matches the app's own plain-rupee-number convention (see
    # oneorder/src/domain/money.ts's round2()), so a mirrored price can never drift from what the
    # app shows via binary float rounding.
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class QrOrderCounter(Base):
    """
    A per-org-per-day sequence used only to give customer-placed orders a short, friendly display
    number (see Order.order_no) - atomically incremented with a single INSERT .. ON CONFLICT ..
    DO UPDATE .. RETURNING statement (see main.py's _next_qr_order_no), so concurrent orders can
    never collide. Deliberately separate from the app's own Settings.orderCounter: that field is a
    synced Firestore document the app's own devices already mutate (last-write-wins, see
    oneorder/src/sync/firebaseBackend.ts) - writing to it from here too would be a second,
    independent writer racing the app's devices for the same counter. See Order.order_no's
    docstring for how the two numbering ranges are kept visibly non-overlapping instead.
    """

    __tablename__ = "qr_order_counters"

    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), primary_key=True)
    day: Mapped[str] = mapped_column(String, primary_key=True)  # 'YYYY-MM-DD'
    n: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Order(Base):
    """
    The durable, authoritative record of a customer-placed order - persisted here before anything
    else happens, so it survives even if the Firestore mirror (see firestore_mirror.py) or a
    customer's connection fails partway (see spec: "orders must remain stored even if a device
    disconnects or a notification fails").
    """

    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.org_id"), nullable=False, index=True)
    qr_table_id: Mapped[str] = mapped_column(ForeignKey("qr_tables.id"), nullable=False, index=True)
    table_local_id: Mapped[str] = mapped_column(String, nullable=False)
    table_label: Mapped[str] = mapped_column(String, nullable=False)
    # Client-generated once per submit attempt and resent unchanged on retry - the unique
    # constraint is what actually stops a flaky network from creating two orders (see POST /orders
    # in main.py). Scoped per-org, not globally, purely so two different orgs' clients can never
    # collide on a key neither of them chose with the other in mind.
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # Offset well clear of the app's own same-day Settings.orderCounter range (see
    # QrOrderCounter's docstring) purely so the two numbers are visibly distinguishable if they're
    # ever seen side by side - they are never compared or merged, just two display labels.
    order_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'received' (in Postgres, not yet mirrored) -> 'mirrored' (Chef/Admin can see it) or
    # 'mirror_failed' (still safely in Postgres; see firestore_mirror.py's retry note).
    status: Mapped[str] = mapped_column(String, nullable=False, default="received")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    mirrored_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # The id this order was written into Firestore under (stores/{STORE_ID}/sessions/{this}) - kept
    # here so a retry of a failed mirror reuses the same document id instead of creating a second one.
    firestore_session_id: Mapped[str] = mapped_column(String, nullable=False, default=_uuid)

    __table_args__ = (UniqueConstraint("org_id", "idempotency_key", name="uq_orders_org_idempotency"),)


class OrderLine(Base):
    __tablename__ = "order_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    menu_item_local_id: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Snapshotted from MenuItemMirror.price at order time - never the client's submitted price
    # (see spec: "Validate every order on the backend instead of trusting the customer app").
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(String, nullable=False, default="")
