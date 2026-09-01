"""Shared pytest fixtures for app/scripts testing.

Mirrors the mcps/garmin/tests/ convention (plain unittest.mock, fixtures in
conftest.py, no pytest-mock). No test here calls a real Garmin/Strava/Zepp
API or a real Supabase project — everything external is mocked.
"""
import base64
import os
import sys
from pathlib import Path

import pytest

# The modules under test (crypto_utils.py, garmin_lib.py, credentials.py,
# backfill_external_account_ids.py) live one directory up from tests/, and
# import each other as bare top-level modules (e.g. `from crypto_utils import
# decrypt`) rather than as a package — same pattern each script uses itself
# via `sys.path.insert(0, os.path.dirname(__file__))`. Put that directory on
# sys.path once, here, so pytest collection can import them the same way.
SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

# credentials.py builds its Supabase client at import time from these three
# env vars (`os.environ[...]`, not `.get(...)` — a real KeyError if unset).
# Set safe dummy values before anything imports it. `supabase.create_client()`
# does no network I/O at construction, so a fake URL/key is safe here; tests
# that exercise behaviour still replace the resulting client with a Mock.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault(
    "CREDENTIAL_ENCRYPTION_KEY",
    base64.b64encode(os.urandom(32)).decode("ascii"),
)


@pytest.fixture
def encryption_key(monkeypatch):
    """A fresh valid 32-byte base64 CREDENTIAL_ENCRYPTION_KEY for a single test."""
    key = base64.b64encode(os.urandom(32)).decode("ascii")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", key)
    return key
