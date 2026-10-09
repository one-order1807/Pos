"""
Shared Redis connection + RQ queue - imported by both main.py (enqueues a mirror job right after
an order commits) and firestore_mirror.py's reconcile_stuck_orders (re-enqueues ones that never
finished). Having both go through the exact same module-level objects, instead of each building
their own Redis client, is what lets reconcile_stuck_orders live in firestore_mirror.py without an
import cycle back to main.py.
"""
import os

import redis
from rq import Queue

redis_client = redis.Redis.from_url(os.environ["REDIS_URL"])
queue = Queue(connection=redis_client)
