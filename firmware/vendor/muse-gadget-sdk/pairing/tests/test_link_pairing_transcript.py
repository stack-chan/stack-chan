# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VECTORS = json.loads((ROOT / "tests/vectors/link_pairing_v5.json").read_text())["vectors"]


def _cc_command() -> list[str]:
    cmd = shlex.split(os.environ.get("CC", "cc"))
    # Fail rather than skip: a missing compiler must not let the pairing
    # security checks pass silently.
    if not cmd or shutil.which(cmd[0]) is None:
        raise RuntimeError("C compiler not available; set CC")
    return cmd


def decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class LinkPairingTranscriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.tmp.name) / "transcript"
        subprocess.run([
            *_cc_command(), "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", str(ROOT / "main"),
            str(ROOT / "main/pairing_transcript.c"),
            str(ROOT / "tests/link_pairing_transcript_harness.c"),
            "-o", str(cls.binary),
        ], check=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_firmware_v5_transcripts_match_shared_mobile_vectors(self) -> None:
        self.assertEqual({v["name"] for v in VECTORS}, {
            "official_v5", "community_v5", "community_app_v5",
        })
        for vector in VECTORS:
            with self.subTest(vector=vector["name"]):
                self.assertEqual(vector["version"], 5)
                transcript = subprocess.check_output([
                    str(self.binary), str(int(vector["community"])), str(vector["pairing_auth_epoch"]),
                    vector["pairing_policy"],
                    *[vector[key] for key in (
                        "device_id", "node_id", "mac", "firmware_version", "mobile_pub",
                        "device_pub", "mobile_nonce", "device_nonce",
                    )],
                ])
                self.assertEqual(transcript, vector["transcript"].encode())
                self.assertFalse(transcript.endswith(b"\n"))
                self.assertEqual(hashlib.sha256(transcript).digest(), decode(vector["transcript_hash"]))
        self.assertEqual(len({v["transcript_hash"] for v in VECTORS}), len(VECTORS))
        self.assertEqual(len({v["session_id"] for v in VECTORS}), len(VECTORS))

    def test_shared_keys_proof_and_records(self) -> None:
        try:
            from cryptography.exceptions import InvalidTag
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec, utils
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        except ModuleNotFoundError as exc:
            raise unittest.SkipTest("cryptography required for real ECDH/ECDSA/AES-GCM vectors") from exc

        for v in VECTORS:
            with self.subTest(vector=v["name"]):
                mobile = ec.derive_private_key(int(v["mobile_private_scalar_hex"], 16), ec.SECP256R1())
                device = ec.derive_private_key(int(v["device_private_scalar_hex"], 16), ec.SECP256R1())
                device_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode(v["device_pub"]))
                mobile_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode(v["mobile_pub"]))
                shared = mobile.exchange(ec.ECDH(), device_pub)
                self.assertEqual(shared, device.exchange(ec.ECDH(), mobile_pub))
                self.assertEqual(shared.hex(), v["ecdh_secret_hex"])
                digest = hashlib.sha256(v["transcript"].encode()).digest()
                salt = hashlib.sha256(decode(v["mobile_nonce"]) + decode(v["device_nonce"]) + digest).digest()
                prk = hmac.new(salt, shared, hashlib.sha256).digest()
                secret = hmac.new(prk, b"hatch-link ble setup v1\x01", hashlib.sha256).digest()
                self.assertEqual(secret.hex(), v["session_secret_hex"])
                tx = hmac.new(secret, b"mobile->device\x01", hashlib.sha256).digest()
                rx = hmac.new(secret, b"device->mobile\x01", hashlib.sha256).digest()
                self.assertEqual(tx.hex(), v["mobile_tx_key_hex"])
                self.assertEqual(rx.hex(), v["mobile_rx_key_hex"])
                self.assertEqual(hashlib.sha256(b"hatch-link session id v1" + digest + shared).digest()[:16], decode(v["session_id"]))
                if v["community"]:
                    self.assertNotIn("device_proof", v)
                else:
                    proof = decode(v["device_proof"])
                    signature = utils.encode_dss_signature(int.from_bytes(proof[:32], "big"), int.from_bytes(proof[32:], "big"))
                    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode(v["auth_public_key"]))
                    key.verify(signature, digest, ec.ECDSA(utils.Prehashed(hashes.SHA256())))
                encrypted = decode(v["client_finished_ciphertext"]) + decode(v["client_finished_tag"])
                aad = f'hatch-link ble setup v1|{v["session_id"]}|m2d|0'.encode()
                self.assertEqual(aad.decode(), v["client_finished_aad"])
                self.assertEqual(AESGCM(tx).decrypt(bytes(12), encrypted, aad).decode(), v["client_finished_plaintext"])
                for bad_nonce, bad_aad, bad_key in (
                    (bytes(11) + b"\x01", aad, tx),
                    (bytes(12), aad + b"x", tx),
                    (bytes(12), aad, rx),
                ):
                    with self.assertRaises(InvalidTag):
                        AESGCM(bad_key).decrypt(bad_nonce, encrypted, bad_aad)


if __name__ == "__main__":
    unittest.main()
