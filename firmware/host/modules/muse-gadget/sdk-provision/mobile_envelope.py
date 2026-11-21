"""Memory-only one-shot envelope. No transport, storage, or device side effects."""
import base64
import hashlib
import re
import secrets
import time
import threading
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


class EnvelopeRejected(Exception):
    def __init__(self):
        super().__init__("Envelope rejected")


class OneShotEnvelope:
    def __init__(self, *, clock=time.monotonic, lifetime=600):
        if not 1 <= lifetime <= 600:
            raise ValueError("Invalid lifetime")
        self._lock = threading.Lock()
        self._clock = clock
        self._deadline = clock() + lifetime
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.session = secrets.token_urlsafe(32)
        self._used = False

    def descriptor(self):
        with self._lock:
            if self._used or self._clock() >= self._deadline:
                self._used = True
                self._key = None
                raise EnvelopeRejected()
            der = self._key.public_key().public_bytes(
                serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            return {"v": 1, "session": self.session,
                    "publicKey": base64.b64encode(der).decode("ascii"),
                    "fingerprint": hashlib.sha256(der).hexdigest(),
                    "remainingSeconds": max(0, int(self._deadline - self._clock()))}

    def consume(self, envelope):
        with self._lock:
            key = self._key
            eligible = not self._used and self._clock() < self._deadline
            self._used = True
            self._key = None
        try:
            if not eligible or not isinstance(envelope, dict):
                raise EnvelopeRejected()
            if set(envelope) != {"v", "session", "ciphertext"}:
                raise EnvelopeRejected()
            if type(envelope["v"]) is not int or envelope["v"] != 1 or envelope["session"] != self.session:
                raise EnvelopeRejected()
            encoded = envelope["ciphertext"]
            if not isinstance(encoded, str) or len(encoded) != 344:
                raise EnvelopeRejected()
            cipher = base64.b64decode(encoded, validate=True)
            if len(cipher) != 256 or base64.b64encode(cipher).decode("ascii") != encoded:
                raise EnvelopeRejected()
            clear = bytearray(key.decrypt(cipher, padding.OAEP(
                mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(),
                label=self.session.encode("ascii"))))
            try:
                prefix = ("MUSESDK1\n" + self.session + "\n").encode("ascii")
                if len(clear) != len(prefix) + 48 or not clear.startswith(prefix):
                    raise EnvelopeRejected()
                token = clear[len(prefix):]
                if not re.fullmatch(rb"mgst_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]", token):
                    token[:] = b"\0" * len(token)
                    raise EnvelopeRejected()
                return token
            finally:
                clear[:] = b"\0" * len(clear)
        except Exception:
            raise EnvelopeRejected() from None
        finally:
            key = None

    def close(self):
        with self._lock:
            self._used = True
            self._key = None
