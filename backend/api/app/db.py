"""
Shared SQLAlchemy engine/session - imported by main.py, gen_key.py, and migrations/env.py so there
is exactly one place that reads DATABASE_URL and builds the engine, instead of each entry point
creating its own.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
