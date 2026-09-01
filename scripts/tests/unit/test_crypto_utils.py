"""Unit tests for crypto_utils.py — AES-256-GCM encrypt/decrypt round-trip.

This wire format has to stay byte-for-byte compatible with the Node side
(app/api/_lib/crypto.ts), so these tests exercise the real `cryptography`
primitives rather than mocking anything — there is nothing external to mock.
"""
import base64

import pytest

import crypto_utils


@pytest.mark.unit
class TestEncryptDecryptRoundTrip:
    def test_round_trip_returns_original_plaintext(self, encryption_key):
        plaintext = "super secret token value"
        ciphertext = crypto_utils.encrypt(plaintext)
        assert crypto_utils.decrypt(ciphertext) == plaintext

    def test_round_trip_with_json_payload(self, encryption_key):
        import json

        payload = {"oauth1_token": "abc", "oauth2_token": "def", "huami_user_id": 12345}
        ciphertext = crypto_utils.encrypt(json.dumps(payload))
        assert json.loads(crypto_utils.decrypt(ciphertext)) == payload

    def test_round_trip_empty_string(self, encryption_key):
        ciphertext = crypto_utils.encrypt("")
        assert crypto_utils.decrypt(ciphertext) == ""

    def test_ciphertext_is_not_plaintext(self, encryption_key):
        plaintext = "do not leak me"
        ciphertext = crypto_utils.encrypt(plaintext)
        assert plaintext not in ciphertext

    def test_encrypt_is_nondeterministic(self, encryption_key):
        # Random 12-byte nonce each call — two encryptions of the same
        # plaintext must not produce the same ciphertext.
        plaintext = "same value twice"
        assert crypto_utils.encrypt(plaintext) != crypto_utils.encrypt(plaintext)

    def test_decrypt_wrong_key_fails(self, encryption_key, monkeypatch):
        ciphertext = crypto_utils.encrypt("secret")
        monkeypatch.setenv(
            "CREDENTIAL_ENCRYPTION_KEY", base64.b64encode(b"\x00" * 32).decode("ascii")
        )
        with pytest.raises(Exception):
            crypto_utils.decrypt(ciphertext)


@pytest.mark.unit
class TestDecryptTamperedInput:
    def test_decrypt_garbage_base64_raises(self, encryption_key):
        with pytest.raises(Exception):
            crypto_utils.decrypt("not-valid-base64-!!!")

    def test_decrypt_truncated_ciphertext_raises(self, encryption_key):
        ciphertext = crypto_utils.encrypt("some value")
        raw = base64.b64decode(ciphertext)
        truncated = base64.b64encode(raw[:10]).decode("ascii")
        with pytest.raises(Exception):
            crypto_utils.decrypt(truncated)

    def test_decrypt_flipped_byte_raises(self, encryption_key):
        """A single flipped ciphertext byte must fail GCM tag verification,
        not silently decrypt to corrupted plaintext."""
        ciphertext = crypto_utils.encrypt("some value")
        raw = bytearray(base64.b64decode(ciphertext))
        raw[-1] ^= 0xFF  # flip the last byte of the GCM tag
        tampered = base64.b64encode(bytes(raw)).decode("ascii")
        with pytest.raises(Exception):
            crypto_utils.decrypt(tampered)


@pytest.mark.unit
class TestKeyValidation:
    def test_missing_key_env_var_raises(self, monkeypatch):
        monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
        with pytest.raises(KeyError):
            crypto_utils.encrypt("x")

    def test_key_wrong_length_raises(self, monkeypatch):
        monkeypatch.setenv(
            "CREDENTIAL_ENCRYPTION_KEY", base64.b64encode(b"too-short").decode("ascii")
        )
        with pytest.raises(ValueError):
            crypto_utils.encrypt("x")
