from concurrent.futures import ThreadPoolExecutor
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).parent.parent
spec = importlib.util.spec_from_file_location("mobile", ROOT / "mobile_envelope.py")
mobile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mobile)
CANARY = "mgst_" + "A" * 43


def envelope(owner, token=CANARY, label=None):
    d = owner.descriptor()
    key = serialization.load_der_public_key(base64.b64decode(d["publicKey"]))
    encrypted = key.encrypt(("MUSESDK1\n" + d["session"] + "\n" + token).encode(),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(),
                     label=(label or d["session"]).encode()))
    return {"v": 1, "session": d["session"], "ciphertext": base64.b64encode(encrypted).decode()}


class Tests(unittest.TestCase):
    def test_roundtrip_once(self):
        owner = mobile.OneShotEnvelope()
        e = envelope(owner)
        clear = owner.consume(e)
        self.assertEqual(clear, CANARY.encode())
        clear[:] = b"\0" * len(clear)
        with self.assertRaises(mobile.EnvelopeRejected): owner.consume(e)
        self.assertIsNone(owner._key)

    def test_concurrent_consume_has_one_winner(self):
        owner = mobile.OneShotEnvelope()
        wire = envelope(owner)
        def consume():
            try:
                clear = owner.consume(wire)
                clear[:] = b"\0" * len(clear)
                return True
            except mobile.EnvelopeRejected:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(lambda _: consume(), range(16))), 1)

    def test_expiry(self):
        now = [0]
        owner = mobile.OneShotEnvelope(clock=lambda: now[0])
        e = envelope(owner)
        now[0] = 600
        with self.assertRaises(mobile.EnvelopeRejected): owner.consume(e)

    def test_malformed_burns_session(self):
        for modify in [lambda e: e.update(v=True), lambda e: e.update(session="x"),
                       lambda e: e.update(ciphertext="A" * 344), lambda e: e.update(extra=1)]:
            owner = mobile.OneShotEnvelope()
            good = envelope(owner)
            bad = dict(good)
            modify(bad)
            with self.assertRaisesRegex(mobile.EnvelopeRejected, "^Envelope rejected$"): owner.consume(bad)
            with self.assertRaises(mobile.EnvelopeRejected): owner.consume(good)

    def test_wrong_label_and_invalid_token(self):
        for kwargs in [{"label": "other"}, {"token": "not-a-token"}]:
            owner = mobile.OneShotEnvelope()
            with self.assertRaises(mobile.EnvelopeRejected): owner.consume(envelope(owner, **kwargs))

    def test_canary_runner_broker_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cipher.json"
            process = subprocess.Popen([sys.executable, str(ROOT / "mobile_canary.py"),
                                        "--envelope-file", str(path)], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True)
            try:
                descriptor = json.loads(process.stdout.readline())
                key = serialization.load_der_public_key(base64.b64decode(descriptor["publicKey"]))
                clear = ("MUSESDK1\n" + descriptor["session"] + "\n" + CANARY).encode()
                encrypted = key.encrypt(clear, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                    algorithm=hashes.SHA256(), label=descriptor["session"].encode()))
                path.write_text(json.dumps({"v": 1, "session": descriptor["session"],
                    "ciphertext": base64.b64encode(encrypted).decode()}))
                out, err = process.communicate(timeout=5)
                self.assertEqual(process.returncode, 0)
                self.assertEqual(out.strip(), "MOBILE ENVELOPE CANARY PASS")
                self.assertEqual(err, "")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_webcrypto_interop(self):
        owner = mobile.OneShotEnvelope()
        script = """
import {readFileSync} from 'node:fs';
const source=readFileSync(process.argv[1], 'utf8');
const {encryptToken}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const descriptor=JSON.parse(readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(await encryptToken(descriptor,'mgst_'+'A'.repeat(43))));
"""
        result = subprocess.run(["node", "--input-type=module", "-e", script, str(ROOT / "mobile-crypto.js")],
                                input=json.dumps(owner.descriptor()), text=True, capture_output=True, check=True)
        clear = owner.consume(json.loads(result.stdout))
        self.assertEqual(clear, CANARY.encode())
        clear[:] = b"\0" * len(clear)


if __name__ == "__main__": unittest.main()
