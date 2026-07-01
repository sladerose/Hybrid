#!/usr/bin/env python3
"""One-shot account connect handshake, run via GitHub Actions workflow_dispatch.

Triggered by app/api/connect-init.ts with only a login_id + source (no secret
material in the dispatch call itself — safe even on a public repo). Reads the
short-lived pending_logins row, decrypts the submitted email+password,
performs the real login against Garmin or Zepp, and stores the result
encrypted in user_credentials. The pending_logins row is deleted
unconditionally, success or failure, so the raw password never persists
beyond this one attempt.

Garmin token shape (from the garminconnect==0.3.2 spike): Garmin(email,
password).login() falls back to the library's cascading login strategies
when no tokenstore is given, and client.client.dumps() then returns the
exact {di_token, di_refresh_token, di_client_id} JSON shape sync_garmin.py
already reads from garmin_tokens.json.
"""

import argparse
import hashlib
import json
import os
import sys
import uuid

import requests
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from crypto_utils import decrypt, encrypt  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def load_pending(login_id: str) -> dict:
    result = supabase.table("pending_logins").select("*").eq("id", login_id).single().execute()
    row = result.data
    if not row:
        raise RuntimeError(f"No pending_logins row for {login_id}")
    return row


def delete_pending(login_id: str) -> None:
    supabase.table("pending_logins").delete().eq("id", login_id).execute()


def set_status(user_id: str, source: str, status: str, last_error: str | None = None) -> None:
    row = {"user_id": user_id, "source": source, "status": status, "last_error": last_error}
    supabase.table("connection_status").upsert(row, on_conflict="user_id,source").execute()


def store_credentials(user_id: str, source: str, payload: dict) -> None:
    supabase.table("user_credentials").upsert(
        {"user_id": user_id, "source": source, "encrypted_payload": encrypt(json.dumps(payload))},
        on_conflict="user_id,source",
    ).execute()


def connect_zepp(email: str, password: str) -> dict:
    """Port of mcps/zepp/get_token.py's Huami login."""
    password_md5 = hashlib.md5(password.encode()).hexdigest()
    device_id = str(uuid.uuid4())

    resp = requests.post(
        "https://account.huami.com/v2/client/login",
        data={
            "client_id": "HuaMi",
            "password": password_md5,
            "redirect_uri": "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html",
            "token": "access",
            "country_code": "en",
            "device_id": device_id,
            "third_name": "huami_xiaomi_watch",
            "app_version": "4.9.0",
            "source": "huami_watch.2.1.3.0",
            "lang": "en",
        },
        timeout=15,
    )
    data = resp.json()
    token_info = data.get("token_info", {})
    app_token = token_info.get("app_token")
    huami_user_id = token_info.get("user_id")

    if not app_token:
        raise RuntimeError("Zepp login failed — check email/password")

    return {"app_token": app_token, "huami_user_id": huami_user_id, "region": "us"}


def connect_garmin(email: str, password: str) -> dict:
    from garminconnect import Garmin

    client = Garmin(email=email, password=password)
    mfa_status, _ = client.login()
    if mfa_status == "needs_mfa":
        raise RuntimeError(
            "This Garmin account has multi-factor authentication enabled — "
            "not yet supported. Disable MFA on the Garmin account to connect."
        )
    return json.loads(client.client.dumps())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--login-id", required=True)
    parser.add_argument("--source", required=True, choices=["garmin", "zepp"])
    args = parser.parse_args()

    pending = load_pending(args.login_id)
    user_id = pending["user_id"]
    source = pending["source"]

    try:
        creds = json.loads(decrypt(pending["encrypted_credentials"]))
        email, password = creds["email"], creds["password"]

        payload = connect_garmin(email, password) if source == "garmin" else connect_zepp(email, password)

        store_credentials(user_id, source, payload)
        set_status(user_id, source, "connected")
        print(f"Connected {source} for user {user_id}")

    except Exception as e:
        # Sanitized — never includes the raw password.
        set_status(user_id, source, "needs_reauth", last_error=str(e))
        print(f"Connect failed for {source}: {e}", file=sys.stderr)
        sys.exit(1)

    finally:
        delete_pending(args.login_id)


if __name__ == "__main__":
    main()
