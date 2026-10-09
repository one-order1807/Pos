"""
Mirrors a confirmed Postgres order into Firestore, in the exact document shape
oneorder/src/sync/firebaseBackend.ts already reads (stores/{STORE_ID}/sessions/{id} and
.../tickets/{id}, each stamped with __syncUpdatedAt) - so the existing RN app's Firestore
listeners pick up a QR-placed order with zero code changes on the app side. mirror_order() runs
inside the `worker` container (see docker-compose.yml) via rq, never inline in the /orders request,
so a slow or unreachable Firestore can never make a customer wait on their own order submission.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone

from sqlalchemy import select

from .db import SessionLocal
from .models import Order, OrderLine
from .queue import queue

log = logging.getLogger("firestore_mirror")

SYNC_TS_FIELD = "__syncUpdatedAt"
STORE_ID = os.environ.get("FIREBASE_STORE_ID", "default")

_firestore_client = None
_firestore_unavailable = False  # sticky for this process once init fails - see _get_firestore()


def _get_firestore():
    """
    Lazy + cached, and firebase_admin is only imported in here - main.py imports mirror_order
    purely to enqueue it, so the api container never needs this package installed/configured,
    only the worker container (which actually calls this) does.
    """
    global _firestore_client, _firestore_unavailable
    if _firestore_client is not None:
        return _firestore_client
    if _firestore_unavailable:
        return None
    cred_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    if not cred_raw:
        log.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set - orders will be saved but not mirrored to Firestore.")
        _firestore_unavailable = True
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            info = json.loads(cred_raw) if cred_raw.lstrip().startswith("{") else cred_raw
            firebase_admin.initialize_app(credentials.Certificate(info))
        _firestore_client = firestore.client()
        return _firestore_client
    except Exception:
        log.exception("Could not initialize the Firebase Admin SDK - orders will be saved but not mirrored.")
        _firestore_unavailable = True
        return None


def _consolidate_items(lines: list[OrderLine]) -> list[dict]:
    # Mirrors oneorder/src/domain/ops.ts's consolidateTicketItems: same name+note collapses onto
    # one kitchen-ticket line with summed quantity, instead of one line per cart entry.
    by_key: dict[tuple[str, str], dict] = {}
    for line in lines:
        key = (line.name, line.note)
        if key in by_key:
            by_key[key]["qty"] += line.qty
        else:
            by_key[key] = {"name": line.name, "qty": line.qty, "note": line.note}
    return list(by_key.values())


def mirror_order(order_id: str) -> None:
    with SessionLocal() as db:
        order = db.get(Order, order_id)
        if order is None:
            log.error("mirror_order: order %s no longer exists", order_id)
            return
        if order.status == "mirrored":
            return  # already done - e.g. a duplicate rq retry landed after a slow success

        lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order.id)).all()
        client = _get_firestore()
        if client is None:
            order.status = "mirror_failed"
            db.commit()
            return

        now_ms = int(time.time() * 1000)
        session_doc = {
            "id": order.firestore_session_id,
            "orderNo": order.order_no,
            "type": "dine-in",
            "tableId": order.table_local_id,
            "status": "open",
            "lines": [
                {
                    "id": line.id,
                    "itemId": line.menu_item_local_id,
                    "name": line.name,
                    "categoryId": "",
                    "unitPrice": float(line.unit_price),
                    "qty": line.qty,
                    "note": line.note,
                    "round": 1,
                }
                for line in lines
            ],
            "rounds": 1,
            "createdAt": now_ms,
            "startedAt": now_ms,
            "billPrintedAt": None,
            "customerName": "",
            "customerPhone": "",
            "paymentMethod": None,
            "paidAt": None,
            "final": None,
            # openedBy is deliberately omitted, not set to some "qr-customer" sentinel - Waiter
            # Mode's own Kitchen/Order views filter sessions to `openedBy === loggedInWaiterId`
            # (oneorder/src/screens/KitchenScreen.tsx), so a QR order has to look like a normal
            # counter-opened order (unset openedBy) to stay visible to a waiter on that device,
            # exactly as types.ts's own doc-comment for Session.openedBy describes a counter order.
            SYNC_TS_FIELD: now_ms,
        }
        ticket_doc = {
            "id": order.firestore_session_id,  # 1:1 with the session here - one ticket, round 1
            "sessionId": order.firestore_session_id,
            "round": 1,
            "label": order.table_label,
            "items": _consolidate_items(lines),
            "status": "pending",
            "sentAt": now_ms,
            "startedAt": None,
            "readyAt": None,
            "servedAt": None,
            "priority": order.order_no,
            "printed": False,
            SYNC_TS_FIELD: now_ms,
        }

        try:
            client.collection("stores").document(STORE_ID).collection("sessions").document(order.firestore_session_id).set(session_doc)
            client.collection("stores").document(STORE_ID).collection("tickets").document(order.firestore_session_id).set(ticket_doc)
        except Exception:
            log.exception("mirror_order: Firestore write failed for order %s", order_id)
            order.status = "mirror_failed"
            db.commit()
            raise  # lets rq's own retry policy (see main.py's enqueue call) try again shortly

        order.status = "mirrored"
        order.mirrored_at = datetime.now(timezone.utc)
        db.commit()


def reconcile_stuck_orders(max_age_seconds: int = 300) -> int:
    """
    Safety net beyond rq's own short-term retries (main.py's enqueue call already covers the first
    few minutes) - catches orders still stuck in 'received' or 'mirror_failed' after a real outage
    (Firestore down longer than that retry window, or the worker container itself restarting
    mid-job and dropping the in-flight job). Call every few minutes from scheduler.py, deliberately
    NOT the once-a-day nightly job already in there - a stuck customer order needs to reach the
    kitchen within minutes, not by the next 22:00 run.
    """
    cutoff = datetime.now(timezone.utc).timestamp() - max_age_seconds
    requeued = 0
    with SessionLocal() as db:
        stuck = db.scalars(select(Order).where(Order.status.in_(["received", "mirror_failed"]))).all()
        for order in stuck:
            # created_at is stored as timezone-aware (see models.py), but a naive datetime's own
            # .timestamp() silently assumes the *local* timezone, not UTC - coerce explicitly so
            # this comparison is correct regardless of whether the DB driver in use hands back a
            # naive or aware value for it (Postgres always does; not every driver does).
            created_at = order.created_at.replace(tzinfo=order.created_at.tzinfo or timezone.utc)
            if created_at.timestamp() > cutoff:
                continue  # still well within rq's own retry window - leave it alone
            try:
                queue.enqueue(mirror_order, order.id)
                requeued += 1
            except Exception:
                # One order's enqueue failing (e.g. Redis itself still down) must not abandon the
                # rest of this sweep, and must not crash the scheduler's run loop - there's always
                # another sweep in 5 minutes to catch this same order again.
                log.exception("reconcile_stuck_orders: failed to re-enqueue order %s", order.id)
    if requeued:
        log.info("reconcile_stuck_orders: re-enqueued %d order(s)", requeued)
    return requeued
