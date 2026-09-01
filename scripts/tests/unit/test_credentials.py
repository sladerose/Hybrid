"""Unit tests for credentials.py — get_active_users().

Covers the "log and continue, don't crash the batch" pattern documented in
.planning/codebase/CONVENTIONS.md: a row that fails to decrypt is skipped
with a stderr warning, not raised.
"""
import json
from unittest.mock import Mock

import pytest

import credentials
import crypto_utils


@pytest.mark.unit
class TestGetActiveUsers:
    def _mock_supabase(self, monkeypatch, rows):
        mock_result = Mock()
        mock_result.data = rows
        mock_supabase = Mock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = (
            mock_result
        )
        monkeypatch.setattr(credentials, "_supabase", mock_supabase)
        return mock_supabase

    def test_good_row_is_decrypted_and_returned(self, monkeypatch, encryption_key):
        good_payload = {"oauth1_token": "abc"}
        rows = [
            {
                "user_id": "user-good",
                "encrypted_payload": crypto_utils.encrypt(json.dumps(good_payload)),
            }
        ]
        self._mock_supabase(monkeypatch, rows)

        result = credentials.get_active_users("garmin")

        assert len(result) == 1
        assert result[0].user_id == "user-good"
        assert result[0].payload == good_payload

    def test_bad_row_is_skipped_with_stderr_warning_not_raised(
        self, monkeypatch, encryption_key, capsys
    ):
        rows = [
            {"user_id": "user-bad", "encrypted_payload": "totally-not-a-valid-ciphertext"},
        ]
        self._mock_supabase(monkeypatch, rows)

        result = credentials.get_active_users("garmin")  # must not raise

        assert result == []
        captured = capsys.readouterr()
        assert "WARNING" in captured.err
        assert "user-bad" in captured.err
        assert captured.out == ""

    def test_mixed_batch_keeps_good_skips_bad_and_does_not_crash(
        self, monkeypatch, encryption_key, capsys
    ):
        good_payload = {"huami_user_id": 42}
        rows = [
            {
                "user_id": "user-good",
                "encrypted_payload": crypto_utils.encrypt(json.dumps(good_payload)),
            },
            {"user_id": "user-bad", "encrypted_payload": "garbage-ciphertext-here"},
        ]
        self._mock_supabase(monkeypatch, rows)

        result = credentials.get_active_users("zepp")

        assert len(result) == 1
        assert result[0].user_id == "user-good"
        assert result[0].payload == good_payload

        captured = capsys.readouterr()
        assert "WARNING" in captured.err
        assert "user-bad" in captured.err
        assert "zepp" in captured.err

    def test_no_rows_returns_empty_list(self, monkeypatch):
        self._mock_supabase(monkeypatch, [])
        assert credentials.get_active_users("strava") == []

    def test_queries_correct_source_and_table(self, monkeypatch):
        mock_supabase = self._mock_supabase(monkeypatch, [])
        credentials.get_active_users("strava")

        mock_supabase.table.assert_called_once_with("user_credentials")
        mock_supabase.table.return_value.select.assert_called_once_with(
            "user_id, encrypted_payload"
        )
        mock_supabase.table.return_value.select.return_value.eq.assert_called_once_with(
            "source", "strava"
        )
