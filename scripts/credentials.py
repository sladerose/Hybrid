"""Shared per-user credential loading + status/token updates for the
recurring sync scripts (sync_garmin.py, sync_strava.py, sync_zepp.py).
"""

import json
import os
import sys
from dataclasses import dataclass

from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from crypto_utils import decrypt, encrypt  # noqa: E402

_supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


@dataclass
class UserCredential:
    user_id: str
    payload: dict


def get_active_users(source: str) -> list[UserCredential]:
    """Users with a stored credential for this source, decrypted.

    A row that fails to decrypt (e.g. key mismatch) is skipped, not fatal —
    logged so it surfaces without taking down the whole batch.
    """
    result = (
        _supabase.table("user_credentials")
        .select("user_id, encrypted_payload")
        .eq("source", source)
        .execute()
    )
    creds = []
    for row in result.data or []:
        try:
            payload = json.loads(decrypt(row["encrypted_payload"]))
            creds.append(UserCredential(user_id=row["user_id"], payload=payload))
        except Exception as e:
            print(
                f"  WARNING: could not decrypt {source} credentials for user {row['user_id']}: {e}",
                file=sys.stderr,
            )
    return creds


def get_user_credential(user_id: str, source: str) -> UserCredential:
    """Single-user lookup for manual/backfill scripts (vs. the batch get_active_users)."""
    result = (
        _supabase.table("user_credentials")
        .select("user_id, encrypted_payload")
        .eq("user_id", user_id)
        .eq("source", source)
        .single()
        .execute()
    )
    row = result.data
    if not row:
        raise RuntimeError(f"No {source} credential stored for user {user_id}")
    payload = json.loads(decrypt(row["encrypted_payload"]))
    return UserCredential(user_id=row["user_id"], payload=payload)


def update_payload(user_id: str, source: str, payload: dict) -> None:
    """Rewrite a user's stored credential payload — used for token rotation."""
    _supabase.table("user_credentials").upsert(
        {"user_id": user_id, "source": source, "encrypted_payload": encrypt(json.dumps(payload))},
        on_conflict="user_id,source",
    ).execute()


def mark_synced(user_id: str, source: str, synced_at: str) -> None:
    _supabase.table("connection_status").upsert(
        {
            "user_id": user_id,
            "source": source,
            "status": "connected",
            "last_synced_at": synced_at,
            "last_error": None,
        },
        on_conflict="user_id,source",
    ).execute()


def mark_failed(user_id: str, source: str, error: str) -> None:
    _supabase.table("connection_status").upsert(
        {"user_id": user_id, "source": source, "status": "needs_reauth", "last_error": error},
        on_conflict="user_id,source",
    ).execute()
