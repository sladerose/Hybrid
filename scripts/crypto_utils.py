"""AES-256-GCM encrypt/decrypt for credential payloads.

Payloads cross the Node (Vercel) / Python (GitHub Actions) boundary, so this
uses AES-256-GCM specifically because it's a native primitive in both
`crypto` (Node) and `cryptography.hazmat` (Python) — no Python-only wire
format like Fernet. Must stay byte-for-byte compatible with
app/api/_lib/crypto.ts.

Wire format: base64( 12-byte nonce || ciphertext || 16-byte GCM tag )
Key: CREDENTIAL_ENCRYPTION_KEY env var, base64-encoded 32 raw bytes.
"""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key() -> bytes:
    raw = os.environ["CREDENTIAL_ENCRYPTION_KEY"]
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes")
    return key


def encrypt(plaintext: str) -> str:
    aesgcm = AESGCM(_key())
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt(encoded: str) -> str:
    aesgcm = AESGCM(_key())
    raw = base64.b64decode(encoded)
    nonce, ciphertext = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
