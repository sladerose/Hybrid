"""Unit tests for backfill_external_account_ids.py.

Covers both backfill_zepp() and backfill_garmin(). Zepp's external id
(huami_user_id) comes straight out of the decrypted payload — pure
decrypt-and-copy. Garmin's (display_name) requires a live-but-mocked
garmin_lib.load_client() login, since it was never persisted into the
stored payload — mock that the same way the rest of this suite mocks
Supabase and crypto_utils.decrypt, never a real API call.
"""
import sys
from unittest.mock import Mock, patch

import pytest

import backfill_external_account_ids as backfill_mod


@pytest.mark.unit
class TestBackfillZepp:
    def _mock_supabase(self, rows):
        mock_supabase = Mock()
        (
            mock_supabase.table.return_value.select.return_value.eq.return_value.is_.return_value.execute.return_value.data
        ) = rows
        return mock_supabase

    def test_dry_run_prints_would_set_and_does_not_call_update(self, capsys):
        rows = [{"user_id": "user-1", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)

        with patch.object(
            backfill_mod, "decrypt", return_value='{"huami_user_id": 12345}'
        ):
            backfill_mod.backfill_zepp(mock_supabase, apply=False)

        captured = capsys.readouterr()
        assert "WOULD SET" in captured.out
        assert "user-1" in captured.out
        assert "external_account_id = 12345" in captured.out
        mock_supabase.table.return_value.update.assert_not_called()

    def test_apply_mode_calls_update_with_extracted_id(self, capsys):
        rows = [{"user_id": "user-1", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)

        with patch.object(
            backfill_mod, "decrypt", return_value='{"huami_user_id": 987654}'
        ):
            backfill_mod.backfill_zepp(mock_supabase, apply=True)

        mock_supabase.table.return_value.update.assert_called_once_with(
            {"external_account_id": "987654"}
        )
        mock_supabase.table.return_value.update.return_value.eq.assert_called_once_with(
            "user_id", "user-1"
        )
        captured = capsys.readouterr()
        assert "OK" in captured.out
        assert "Done: 1 backfilled, 0 skipped, 0 failed." in captured.out

    def test_row_missing_id_field_is_skipped_not_written(self, capsys):
        rows = [{"user_id": "user-no-id", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)

        with patch.object(backfill_mod, "decrypt", return_value='{"some_other_field": "x"}'):
            backfill_mod.backfill_zepp(mock_supabase, apply=True)

        mock_supabase.table.return_value.update.assert_not_called()
        captured = capsys.readouterr()
        assert "SKIPPED" in captured.out
        assert "user-no-id" in captured.out
        assert "Done: 0 backfilled, 1 skipped, 0 failed." in captured.out

    def test_decrypt_failure_is_logged_and_batch_continues(self, capsys):
        rows = [
            {"user_id": "user-bad", "encrypted_payload": "garbage"},
            {"user_id": "user-good", "encrypted_payload": "cipher-good"},
        ]
        mock_supabase = self._mock_supabase(rows)

        def fake_decrypt(payload):
            if payload == "garbage":
                raise ValueError("bad ciphertext")
            return '{"huami_user_id": 111}'

        with patch.object(backfill_mod, "decrypt", side_effect=fake_decrypt):
            with pytest.raises(SystemExit) as exc_info:
                backfill_mod.backfill_zepp(mock_supabase, apply=True)

        assert exc_info.value.code == 1

        # The failed row must not have blocked the good row from being processed.
        mock_supabase.table.return_value.update.assert_called_once_with(
            {"external_account_id": "111"}
        )

        captured = capsys.readouterr()
        assert "FAILED" in captured.err
        assert "user-bad" in captured.err
        assert "user-good" not in captured.err
        assert "Done: 1 backfilled, 0 skipped, 1 failed." in captured.out

    def test_no_rows_needing_backfill_prints_message_and_returns(self, capsys):
        mock_supabase = self._mock_supabase([])
        backfill_mod.backfill_zepp(mock_supabase, apply=False)

        captured = capsys.readouterr()
        assert "No zepp rows need backfilling" in captured.out
        mock_supabase.table.return_value.update.assert_not_called()

    def test_update_failure_is_logged_and_batch_continues(self, capsys):
        """A DB-level failure on write (e.g. UNIQUE constraint violation —
        the exact corruption case this script exists to catch) must be
        logged, not raised, so later rows in the same run still get a
        chance to be processed."""
        rows = [
            {"user_id": "user-conflict", "encrypted_payload": "cipher-1"},
            {"user_id": "user-good", "encrypted_payload": "cipher-2"},
        ]
        mock_supabase = self._mock_supabase(rows)
        mock_supabase.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.side_effect = [
            RuntimeError("duplicate key value violates unique constraint"),
            None,
        ]

        with patch.object(
            backfill_mod, "decrypt", return_value='{"huami_user_id": 555}'
        ):
            with pytest.raises(SystemExit):
                backfill_mod.backfill_zepp(mock_supabase, apply=True)

        captured = capsys.readouterr()
        assert "FAILED" in captured.err
        assert "user-conflict" in captured.err
        assert "Done: 1 backfilled, 0 skipped, 1 failed." in captured.out


@pytest.mark.unit
class TestBackfillGarmin:
    """Garmin's external id (display_name) is not in the stored payload, so
    unlike Zepp this path calls garmin_lib.load_client() — mocked here, no
    real Garmin login ever happens."""

    def _mock_supabase(self, rows):
        mock_supabase = Mock()
        (
            mock_supabase.table.return_value.select.return_value.eq.return_value.is_.return_value.execute.return_value.data
        ) = rows
        return mock_supabase

    def test_dry_run_prints_would_set_and_does_not_call_update(self, capsys):
        rows = [{"user_id": "user-1", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)
        mock_client = Mock(display_name="SladeR")

        with patch.object(backfill_mod, "decrypt", return_value='{"oauth1_token": "abc"}'), patch.object(
            backfill_mod.garmin_lib, "load_client", return_value=mock_client
        ):
            backfill_mod.backfill_garmin(mock_supabase, apply=False)

        captured = capsys.readouterr()
        assert "WOULD SET" in captured.out
        assert "user-1" in captured.out
        assert "external_account_id = SladeR" in captured.out
        mock_supabase.table.return_value.update.assert_not_called()

    def test_apply_mode_calls_update_with_display_name(self, capsys):
        rows = [{"user_id": "user-1", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)
        mock_client = Mock(display_name="SladeR")

        with patch.object(backfill_mod, "decrypt", return_value='{"oauth1_token": "abc"}'), patch.object(
            backfill_mod.garmin_lib, "load_client", return_value=mock_client
        ):
            backfill_mod.backfill_garmin(mock_supabase, apply=True)

        mock_supabase.table.return_value.update.assert_called_once_with(
            {"external_account_id": "SladeR"}
        )
        mock_supabase.table.return_value.update.return_value.eq.assert_called_once_with(
            "user_id", "user-1"
        )
        captured = capsys.readouterr()
        assert "OK" in captured.out
        assert "Done: 1 backfilled, 0 skipped, 0 failed." in captured.out

    def test_row_with_no_display_name_is_skipped(self, capsys):
        rows = [{"user_id": "user-1", "encrypted_payload": "cipher-1"}]
        mock_supabase = self._mock_supabase(rows)
        mock_client = Mock(display_name=None)

        with patch.object(backfill_mod, "decrypt", return_value='{"oauth1_token": "abc"}'), patch.object(
            backfill_mod.garmin_lib, "load_client", return_value=mock_client
        ):
            backfill_mod.backfill_garmin(mock_supabase, apply=True)

        mock_supabase.table.return_value.update.assert_not_called()
        captured = capsys.readouterr()
        assert "SKIPPED" in captured.out
        assert "user-1" in captured.out
        assert "Done: 0 backfilled, 1 skipped, 0 failed." in captured.out

    def test_decrypt_failure_is_logged_and_batch_continues(self, capsys):
        rows = [
            {"user_id": "user-bad", "encrypted_payload": "garbage"},
            {"user_id": "user-good", "encrypted_payload": "cipher-good"},
        ]
        mock_supabase = self._mock_supabase(rows)
        mock_client = Mock(display_name="GoodUser")

        def fake_decrypt(payload):
            if payload == "garbage":
                raise ValueError("bad ciphertext")
            return '{"oauth1_token": "abc"}'

        with patch.object(backfill_mod, "decrypt", side_effect=fake_decrypt), patch.object(
            backfill_mod.garmin_lib, "load_client", return_value=mock_client
        ):
            with pytest.raises(SystemExit) as exc_info:
                backfill_mod.backfill_garmin(mock_supabase, apply=True)

        assert exc_info.value.code == 1
        mock_supabase.table.return_value.update.assert_called_once_with(
            {"external_account_id": "GoodUser"}
        )
        captured = capsys.readouterr()
        assert "FAILED" in captured.err
        assert "user-bad" in captured.err
        assert "user-good" not in captured.err
        assert "Done: 1 backfilled, 0 skipped, 1 failed." in captured.out

    def test_live_login_failure_is_logged_and_batch_continues(self, capsys):
        """load_client() (the mocked live-but-read-only Garmin login) can
        itself fail — expired refresh token, network error, etc. That must
        be logged like any other per-row failure, not crash the batch."""
        rows = [
            {"user_id": "user-bad-login", "encrypted_payload": "cipher-1"},
            {"user_id": "user-good", "encrypted_payload": "cipher-2"},
        ]
        mock_supabase = self._mock_supabase(rows)
        mock_client = Mock(display_name="GoodUser")

        with patch.object(
            backfill_mod, "decrypt", return_value='{"oauth1_token": "abc"}'
        ), patch.object(
            backfill_mod.garmin_lib,
            "load_client",
            side_effect=[RuntimeError("token expired"), mock_client],
        ):
            with pytest.raises(SystemExit) as exc_info:
                backfill_mod.backfill_garmin(mock_supabase, apply=True)

        assert exc_info.value.code == 1
        mock_supabase.table.return_value.update.assert_called_once_with(
            {"external_account_id": "GoodUser"}
        )
        captured = capsys.readouterr()
        assert "FAILED" in captured.err
        assert "user-bad-login" in captured.err
        assert "live Garmin login failed" in captured.err
        assert "Done: 1 backfilled, 0 skipped, 1 failed." in captured.out

    def test_no_rows_needing_backfill_prints_message_and_returns(self, capsys):
        mock_supabase = self._mock_supabase([])
        backfill_mod.backfill_garmin(mock_supabase, apply=False)

        captured = capsys.readouterr()
        assert "No garmin rows need backfilling" in captured.out
        mock_supabase.table.return_value.update.assert_not_called()


@pytest.mark.unit
class TestArgParsing:
    def test_invalid_source_is_rejected(self):
        with patch.object(
            sys, "argv", ["backfill_external_account_ids.py", "--source", "strava"]
        ):
            with pytest.raises(SystemExit):
                backfill_mod.main()

    @patch("backfill_external_account_ids.create_client")
    @patch("backfill_external_account_ids.backfill_zepp")
    def test_source_zepp_dispatches_to_backfill_zepp(self, mock_backfill_zepp, mock_create_client):
        mock_supabase = Mock()
        mock_create_client.return_value = mock_supabase

        with patch.object(sys, "argv", ["backfill_external_account_ids.py", "--source", "zepp"]):
            backfill_mod.main()

        mock_backfill_zepp.assert_called_once_with(mock_supabase, False)

    @patch("backfill_external_account_ids.create_client")
    @patch("backfill_external_account_ids.backfill_garmin")
    def test_source_garmin_dispatches_to_backfill_garmin(self, mock_backfill_garmin, mock_create_client):
        mock_supabase = Mock()
        mock_create_client.return_value = mock_supabase

        with patch.object(sys, "argv", ["backfill_external_account_ids.py", "--source", "garmin", "--apply"]):
            backfill_mod.main()

        mock_backfill_garmin.assert_called_once_with(mock_supabase, True)
