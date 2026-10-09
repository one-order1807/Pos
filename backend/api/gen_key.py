#!/usr/bin/env python
"""
Generates a time-limited activation code for THIS deployment's org (read from ORG_ID/ORG_NAME in
its own environment - the same env the api container already runs with). Run it on the server:

    docker compose run --rm api python gen_key.py
    docker compose run --rm api python gen_key.py 300   # custom TTL in seconds, default 600 (10 min)

Hand the printed code to whoever is installing the app - they type it into the app's first-launch
"Access key" screen within the printed expiry window. Each code is single-use: /activate marks it
used the instant it's redeemed, and it's stored as a SHA-256 hash only, never in plaintext, so a
database dump alone can never hand out a currently-valid code.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import ActivationKey, Organization
from app.security import DEFAULT_TTL_SECONDS, generate_code, hash_code

ORG_ID = os.environ["ORG_ID"]
ORG_NAME = os.environ.get("ORG_NAME", ORG_ID)


def main() -> None:
    ttl = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TTL_SECONDS
    with SessionLocal() as db:
        if db.get(Organization, ORG_ID) is None:
            db.add(Organization(org_id=ORG_ID, org_name=ORG_NAME))
            db.commit()
        code = generate_code()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
        db.add(ActivationKey(org_id=ORG_ID, code_hash=hash_code(code), expires_at=expires_at))
        db.commit()
    mins = ttl / 60
    print(f"Access key for {ORG_NAME} ({ORG_ID}): {code}")
    print(f"Expires in {mins:g} minute(s), at {expires_at.isoformat()}.")


if __name__ == "__main__":
    main()
