"""
Placeholder for the low-traffic-hours scheduler (10 PM-12 AM reconciliation/reporting/archival,
per the original spec) - NOT wired to any real job yet, just the pattern to add jobs to.

`schedule` (not Celery beat or APScheduler's full feature set) because this box only ever needs to
fire a handful of jobs a day - no real benefit to a heavier scheduler for that.

Deliberately separate from the `worker` service/queue - a slow nightly job must never be able to
delay a real-time order or kitchen-notification job, so they run as different containers that
can't contend with each other for the same process's attention.
"""

import logging
import time

import schedule

from app.firestore_mirror import reconcile_stuck_orders

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("scheduler")


def nightly_reconciliation():
    # TODO (Phase 2+): reconcile synced order/session data, archive old records, build reports.
    # Deliberately a no-op placeholder - there is no real reconciliation logic defined yet, and
    # this must never be mistaken for one by anything reading the logs.
    log.info("nightly_reconciliation: placeholder run (no-op - no real job wired up yet)")


schedule.every().day.at("22:00").do(nightly_reconciliation)
# Deliberately a separate, much more frequent job from the nightly placeholder above - a
# QR-ordered customer is waiting right now, so a stuck order needs to reach the kitchen within
# minutes of a real outage, not by the next 22:00 run. See reconcile_stuck_orders's own docstring.
schedule.every(5).minutes.do(reconcile_stuck_orders)

if __name__ == "__main__":
    log.info("scheduler started - nightly_reconciliation at 22:00, reconcile_stuck_orders every 5 minutes")
    while True:
        schedule.run_pending()
        time.sleep(30)
