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
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
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
