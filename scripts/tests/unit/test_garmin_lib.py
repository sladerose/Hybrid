"""Unit tests for garmin_lib.py's small pure/loading helpers.

`_int()` specifically covers the class of bug behind the 2 Jul 2026 incident:
Garmin's API occasionally returns a float (e.g. `97.0`) for a field mapped to
a Postgres `int` column, which Postgres rejects outright.
"""
import json
import os
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

import garmin_lib


@pytest.mark.unit
class TestInt:
    def test_none_passes_through_as_none(self):
        assert garmin_lib._int(None) is None

    def test_int_passes_through(self):
        assert garmin_lib._int(97) == 97

    def test_float_coerces_to_int(self):
        assert garmin_lib._int(97.0) == 97

    def test_float_as_string_coerces_to_int(self):
        # The exact shape of the 2 Jul 2026 incident: Garmin's raw JSON
        # sometimes serialises an int-looking field as "97.0".
        assert garmin_lib._int("97.0") == 97

    def test_int_as_string_coerces_to_int(self):
        assert garmin_lib._int("97") == 97

    def test_zero_stays_zero_not_none(self):
        assert garmin_lib._int(0) == 0
        assert garmin_lib._int("0.0") == 0


@pytest.mark.unit
class TestPct:
    def test_normal_division(self):
        assert garmin_lib.pct(25, 100) == 25.0

    def test_rounds_to_one_decimal(self):
        assert garmin_lib.pct(1, 3) == 33.3

    def test_total_zero_returns_none_not_zerodivisionerror(self):
        assert garmin_lib.pct(5, 0) is None

    def test_part_zero(self):
        assert garmin_lib.pct(0, 100) == 0.0


@pytest.mark.unit
class TestLoadClient:
    @patch("garmin_lib.Garmin")
    def test_writes_payload_to_tokenstore_and_logs_in(self, mock_garmin_cls):
        captured = {}
        mock_client = Mock()

        def fake_login(tokenstore):
            # Assert *while* the TemporaryDirectory is still alive — it's
            # cleaned up by the `with` block before load_client() returns.
            token_file = Path(tokenstore) / "garmin_tokens.json"
            assert token_file.exists()
            captured["payload"] = json.loads(token_file.read_text())
            captured["tokenstore"] = tokenstore

        mock_client.login = Mock(side_effect=fake_login)
        mock_garmin_cls.return_value = mock_client

        payload = {"oauth1_token": "abc", "oauth2_token": "def"}
        result = garmin_lib.load_client(payload)

        assert result is mock_client
        mock_client.login.assert_called_once()
        assert captured["payload"] == payload
        # tempdir is cleaned up on the way out
        assert not os.path.exists(captured["tokenstore"])

    @patch("garmin_lib.Garmin")
    def test_login_failure_propagates(self, mock_garmin_cls):
        mock_client = Mock()
        mock_client.login = Mock(side_effect=RuntimeError("auth failed"))
        mock_garmin_cls.return_value = mock_client

        with pytest.raises(RuntimeError, match="auth failed"):
            garmin_lib.load_client({"oauth1_token": "abc"})


@pytest.mark.unit
class TestSyncWeeklyStress:
    """Confirmed live 2026-09-01: garmin_weekly_stress had 398 rows, every
    stress_value NULL, week_start spread across all 7 weekdays — the old
    code read nonexistent field names (startTimestampGMT/overallStressLevel/
    stressLevel) and never bucketed by week. These tests lock in the fix:
    real field names (calendarDate/value), and correctness regardless of
    whether Garmin hands back daily or already-weekly entries.
    """

    def _mock_supabase(self):
        supabase = Mock()
        table = Mock()
        supabase.table.return_value = table
        upsert = Mock()
        table.upsert.return_value = upsert
        upsert.execute.return_value = Mock()
        return supabase, table

    def test_daily_entries_collapse_into_one_averaged_weekly_row(self):
        # A full ISO week (Mon 2026-08-03 .. Sun 2026-08-09) as 7 separate
        # daily entries, the exact shape observed live in production.
        client = Mock()
        client.get_weekly_stress.return_value = [
            {"calendarDate": f"2026-08-{day:02d}", "value": value}
            for day, value in zip(range(3, 10), [30, 32, 34, 36, 38, 40, 42])
        ]
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        table.upsert.assert_called_once()
        rows, kwargs = table.upsert.call_args
        assert kwargs["on_conflict"] == "user_id,week_start"
        assert len(rows[0]) == 1
        row = rows[0][0]
        assert row["user_id"] == "user-1"
        assert row["week_start"] == "2026-08-03"  # Monday of that week
        assert row["stress_value"] == 36  # average of 30..42 step 2

    def test_already_weekly_entries_stay_separate_rows(self):
        # If Garmin ever does hand back genuine weekly entries (7 days
        # apart), each should still land as its own row, not get merged.
        client = Mock()
        client.get_weekly_stress.return_value = [
            {"calendarDate": "2026-08-03", "value": 35},
            {"calendarDate": "2026-07-27", "value": 41},
        ]
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        rows = table.upsert.call_args[0][0]
        week_starts = {r["week_start"]: r["stress_value"] for r in rows}
        assert week_starts == {"2026-08-03": 35, "2026-07-27": 41}

    def test_entries_missing_value_are_excluded(self):
        client = Mock()
        client.get_weekly_stress.return_value = [
            {"calendarDate": "2026-08-03", "value": 35},
            {"calendarDate": "2026-08-04", "value": None},
            {"calendarDate": "2026-08-05"},  # no value key at all
        ]
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        rows = table.upsert.call_args[0][0]
        assert len(rows) == 1
        assert rows[0]["stress_value"] == 35

    def test_entry_missing_calendar_date_is_skipped(self):
        client = Mock()
        client.get_weekly_stress.return_value = [{"value": 35}]
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        table.upsert.assert_not_called()

    def test_empty_response_does_not_call_upsert(self):
        client = Mock()
        client.get_weekly_stress.return_value = []
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        table.upsert.assert_not_called()

    def test_dict_shaped_response_reads_weeklystress_key(self):
        client = Mock()
        client.get_weekly_stress.return_value = {
            "weeklyStress": [{"calendarDate": "2026-08-03", "value": 35}]
        }
        supabase, table = self._mock_supabase()

        garmin_lib.sync_weekly_stress(supabase, client, "user-1", "2026-08-09")

        rows = table.upsert.call_args[0][0]
        assert rows[0]["stress_value"] == 35
