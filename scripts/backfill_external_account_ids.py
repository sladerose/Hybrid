#!/usr/bin/env python3
"""One-off remediation: populate user_credentials.external_account_id for
rows written before the 2026-07-05 uniqueness fix
(database/migrations/20260705_add_external_account_uniqueness.sql).

Those pre-fix rows have external_account_id = NULL, so the UNIQUE(source,
external_account_id) constraint doesn't protect them — a second Supabase
user connecting the same real Garmin/Zepp account today would silently
reassign or duplicate that user's data again (see the 2 Jul 2026 incident
note in CLAUDE.md, and the "Remaining exposure" entry in
.planning/codebase/CONCERNS.md).

Zepp: huami_user_id is already inside the encrypted payload
(connect_account.py's connect_zepp() puts it there) — this is a pure
decrypt-and-copy, no live API call.

Garmin: display_name was only ever read at login time and never persisted
into the stored payload, so backfilling it needs a live authenticated call
using the stored refresh token. This reuses garmin_lib.load_client(), the
exact same tokenstore-login helper sync_garmin.py already calls on every
4x-daily cron run for every user — writing the stored token payload to a
temp dir and calling client.login(tokenstore=tmp). No password is stored
for Garmin anywhere in this system, and none is requested or used here:
the login is entirely driven by the already-stored refresh token, and the
call is read-only (login + read .display_name, nothing else). After a
successful login, client.display_name is populated exactly as it is in
connect_account.py's connect_garmin() right after a fresh password login —
this script just persists that same value instead of discarding it.

Defaults to dry-run (report only). Pass --apply to actually write.

GitHub Secrets / env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
CREDENTIAL_ENCRYPTION_KEY.

Usage:
  python backfill_external_account_ids.py --source zepp             # dry run
  python backfill_external_account_ids.py --source zepp --apply     # write
  python backfill_external_account_ids.py --source garmin           # dry run
  python backfill_external_account_ids.py --source garmin --apply   # write
"""

import argparse
import json
import os
import sys

from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from crypto_utils import decrypt  # noqa: E402
import garmin_lib  # noqa: E402


def backfill_zepp(supabase, apply: bool) -> None:
    rows = (
        supabase.table("user_credentials")
        .select("user_id, encrypted_payload")
        .eq("source", "zepp")
        .is_("external_account_id", "null")
        .execute()
        .data
        or []
    )

    if not rows:
        print("No zepp rows need backfilling — external_account_id already set everywhere.")
        return

    print(f"Found {len(rows)} zepp row(s) with external_account_id = NULL:\n")

    backfilled, skipped, failed = 0, 0, 0

    for row in rows:
        user_id = row["user_id"]
        try:
            payload = json.loads(decrypt(row["encrypted_payload"]))
        except Exception as e:
            print(f"  FAILED  {user_id}: could not decrypt payload — {e}", file=sys.stderr)
            failed += 1
            continue

        huami_user_id = payload.get("huami_user_id")
        if huami_user_id is None:
            print(f"  SKIPPED {user_id}: no huami_user_id in stored payload")
            skipped += 1
            continue

        external_account_id = str(huami_user_id)

        if not apply:
            print(f"  WOULD SET {user_id} -> external_account_id = {external_account_id}")
            continue

        try:
            supabase.table("user_credentials").update(
                {"external_account_id": external_account_id}
            ).eq("user_id", user_id).eq("source", "zepp").execute()
            print(f"  OK      {user_id} -> external_account_id = {external_account_id}")
            backfilled += 1
        except Exception as e:
            # Most likely a UNIQUE(source, external_account_id) violation — meaning
            # this same Zepp account is ALSO linked (with a NULL id) to another
            # user. That's the exact corruption this fix exists to catch; it needs
            # a human to look at both rows, not a silent overwrite.
            print(f"  FAILED  {user_id}: {e}", file=sys.stderr)
            failed += 1

    print()
    if apply:
        print(f"Done: {backfilled} backfilled, {skipped} skipped, {failed} failed.")
    else:
        print(f"Dry run: {len(rows) - skipped - failed} would be set, {skipped} skipped, "
              f"{failed} failed to decrypt. Re-run with --apply to write.")

    if failed:
        sys.exit(1)


def backfill_garmin(supabase, apply: bool) -> None:
    rows = (
        supabase.table("user_credentials")
        .select("user_id, encrypted_payload")
        .eq("source", "garmin")
        .is_("external_account_id", "null")
        .execute()
        .data
        or []
    )

    if not rows:
        print("No garmin rows need backfilling — external_account_id already set everywhere.")
        return

    print(f"Found {len(rows)} garmin row(s) with external_account_id = NULL:\n")

    backfilled, skipped, failed = 0, 0, 0

    for row in rows:
        user_id = row["user_id"]
        try:
            payload = json.loads(decrypt(row["encrypted_payload"]))
        except Exception as e:
            print(f"  FAILED  {user_id}: could not decrypt payload — {e}", file=sys.stderr)
            failed += 1
            continue

        try:
            # Live, read-only login using only the stored refresh token — the
            # same tokenstore pattern sync_garmin.py already runs 4x/day for
            # every user. No password involved anywhere in this path.
            client = garmin_lib.load_client(payload)
        except Exception as e:
            print(f"  FAILED  {user_id}: live Garmin login failed — {e}", file=sys.stderr)
            failed += 1
            continue

        display_name = client.display_name
        if not display_name:
            print(f"  SKIPPED {user_id}: login succeeded but no display_name on client")
            skipped += 1
            continue

        external_account_id = str(display_name)

        if not apply:
            print(f"  WOULD SET {user_id} -> external_account_id = {external_account_id}")
            continue

        try:
            supabase.table("user_credentials").update(
                {"external_account_id": external_account_id}
            ).eq("user_id", user_id).eq("source", "garmin").execute()
            print(f"  OK      {user_id} -> external_account_id = {external_account_id}")
            backfilled += 1
        except Exception as e:
            # Most likely a UNIQUE(source, external_account_id) violation — meaning
            # this same Garmin account is ALSO linked (with a NULL id) to another
            # user. That's the exact corruption this fix exists to catch; it needs
            # a human to look at both rows, not a silent overwrite.
            print(f"  FAILED  {user_id}: {e}", file=sys.stderr)
            failed += 1

    print()
    if apply:
        print(f"Done: {backfilled} backfilled, {skipped} skipped, {failed} failed.")
    else:
        print(f"Dry run: {len(rows) - skipped - failed} would be set, {skipped} skipped, "
              f"{failed} failed to decrypt or log in. Re-run with --apply to write.")

    if failed:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, choices=["zepp", "garmin"])
    parser.add_argument("--apply", action="store_true", help="Write changes. Omit for a dry-run report.")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    if args.source == "zepp":
        backfill_zepp(supabase, args.apply)
    elif args.source == "garmin":
        backfill_garmin(supabase, args.apply)


if __name__ == "__main__":
    main()
