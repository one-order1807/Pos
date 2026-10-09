"""
Activation-code generation/hashing, shared by gen_key.py (which creates codes on the server) and
main.py (which verifies them from the app). Codes are never stored in plaintext - only their
SHA-256 hash - so a database dump alone can never hand out a currently-valid code.
"""
import hashlib
import secrets

# Excludes 0/O and 1/I/l so a code read aloud over the phone is never ambiguous.
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ-#@*"
CODE_LENGTH = 10
DEFAULT_TTL_SECONDS = 10 * 60


def generate_code(length: int = CODE_LENGTH) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_code(code: str) -> str:
    return code.strip().upper()


def hash_code(code: str) -> str:
    return hashlib.sha256(normalize_code(code).encode()).hexdigest()


def generate_device_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_eq(a: str, b: str) -> bool:
    return secrets.compare_digest(a, b)
