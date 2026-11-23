import importlib.util
import io
from pathlib import Path
import sys
import unittest
import warnings
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("openai_host", Path(__file__).parent.parent / "host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
FIXTURE = "sk-" + "A" * 40
ARGS = ["host.py", "--port", "COM18", "--expected-serial", "PUBLIC-SERIAL"]


class Port:
    def __init__(self, reply=b"OPENAI KEY SAVED\n", short=False):
        self.responses = [b"OPENAI KEY INPUT READY\n", reply]
        self.sent = bytearray()
        self.chunks = []
        self.short = short

    def reset_input_buffer(self):
        self.cleared = True

    def read(self, size):
        return self.responses.pop(0) if self.responses else b""

    def write(self, data):
        self.chunks.append(data)
        self.sent.extend(data)
        return len(data) - int(self.short)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Tests(unittest.TestCase):
    def test_validation_boundaries_and_bad_characters(self):
        for length in (32, 43, 164, 512):
            self.assertTrue(host.valid_token("sk-" + "A" * (length - 3)))
        for value in (None, "", "sk-" + "A" * 28, "sk-" + "A" * 510,
                      "xx-" + "A" * 40, FIXTURE + "\n", FIXTURE + " ",
                      FIXTURE + "é", FIXTURE + ":", FIXTURE + "/"):
            self.assertFalse(host.valid_token(value))

    def run_main(self, *, tty=True, identity=True, answer="SAVE", token=FIXTURE,
                 extra=(), port=None):
        import serial
        out = io.StringIO()
        port = port or Port()
        with patch.object(sys, "argv", ARGS + list(extra)), \
                patch.object(sys, "stdin", Mock(isatty=lambda: tty)), \
                patch.object(sys, "stdout", out), \
                patch.object(host, "matching_device", side_effect=identity if isinstance(identity, list) else None,
                             return_value=identity), \
                patch("builtins.input", return_value=answer) as confirm, \
                patch.object(host.getpass, "getpass", return_value=token) as prompt, \
                patch.object(serial, "Serial", return_value=port) as opened, \
                patch.object(host.time, "sleep"):
            result = host.main()
        self.assertNotIn(FIXTURE, out.getvalue())
        return result, out.getvalue(), confirm, prompt, opened, port

    def test_non_tty_never_prompts_or_opens(self):
        result, _, confirm, prompt, opened, _ = self.run_main(tty=False)
        self.assertEqual(result, 1)
        confirm.assert_not_called()
        prompt.assert_not_called()
        opened.assert_not_called()

    def test_wrong_usb_identity_refuses_before_input(self):
        result, _, confirm, prompt, opened, _ = self.run_main(identity=False)
        self.assertEqual(result, 1)
        confirm.assert_not_called()
        prompt.assert_not_called()
        opened.assert_not_called()

    def test_changed_usb_identity_refuses_after_input(self):
        result, _, _, prompt, opened, _ = self.run_main(identity=[True, False])
        self.assertEqual(result, 1)
        prompt.assert_called_once()
        opened.assert_not_called()

    def test_decline_does_not_request_key(self):
        result, _, _, prompt, opened, _ = self.run_main(answer="no")
        self.assertEqual(result, 1)
        prompt.assert_not_called()
        opened.assert_not_called()

    def test_bad_key_not_transmitted(self):
        result, _, _, _, opened, _ = self.run_main(token="invalid")
        self.assertEqual(result, 1)
        opened.assert_not_called()

    def test_success_is_hidden_and_mutable_chunks_are_wiped(self):
        result, output, _, prompt, opened, port = self.run_main()
        self.assertEqual(result, 0)
        self.assertIn("SAVED", output)
        self.assertIn("ai/token", output)
        prompt.assert_called_once_with("OpenAI API key (hidden): ")
        opened.assert_called_once()
        self.assertEqual(port.sent, ("OPENAI:" + FIXTURE + "\n").encode())
        self.assertTrue(all(not any(chunk) for chunk in port.chunks))

    def test_payload_wiped_even_when_exchange_raises(self):
        seen = []
        def fail(port, payload):
            seen.append(payload)
            raise RuntimeError(FIXTURE)
        with patch.object(host, "exchange", side_effect=fail):
            result, output, _, _, _, _ = self.run_main()
        self.assertEqual(result, 1)
        self.assertNotIn(FIXTURE, output)
        self.assertTrue(seen)
        self.assertFalse(any(seen[0]))

    def test_getpass_echo_fallback_is_refused(self):
        import serial
        def fallback(*args):
            warnings.warn("cannot disable echo", host.getpass.GetPassWarning)
            self.fail("must not proceed with echo")
        with patch.object(sys, "argv", ARGS), patch.object(sys, "stdin", Mock(isatty=lambda: True)), \
                patch.object(sys, "stdout", io.StringIO()), patch.object(host, "matching_device", return_value=True), \
                patch("builtins.input", return_value="SAVE"), patch.object(host.getpass, "getpass", side_effect=fallback), \
                patch.object(serial, "Serial") as opened:
            self.assertEqual(host.main(), 1)
            opened.assert_not_called()

    def test_argument_error_never_echoes_value(self):
        with patch.object(sys, "argv", ARGS + ["--token", FIXTURE]), patch.object(sys, "stderr", io.StringIO()) as out:
            with self.assertRaises(SystemExit):
                host.main()
            self.assertNotIn(FIXTURE, out.getvalue())

    def test_canary_does_not_request_key_or_tty(self):
        result, output, confirm, prompt, _, port = self.run_main(
            tty=False, extra=["--canary"], port=Port(b"OPENAI KEY CANARY PASS\n"))
        self.assertEqual(result, 0)
        self.assertIn("CANARY PASS", output)
        confirm.assert_not_called()
        prompt.assert_not_called()
        self.assertEqual(port.sent, b"CANARY\n")

    def test_wrong_ack_rejected_without_serial_output(self):
        for reply in (b"OPENAI KEY CANARY PASS\n", b"OPENAI KEY EXISTS\n",
                      b"OPENAI KEY REJECTED\n", b"OPENAI KEY SAVED suffix\n", FIXTURE.encode() + b"\n"):
            ticks = iter(range(1000))
            with patch.object(host.time, "monotonic", side_effect=lambda: next(ticks)):
                result, output, _, _, _, _ = self.run_main(port=Port(reply))
            self.assertEqual(result, 1)
            self.assertIn("RESULT NOT CONFIRMED", output)

    def test_short_write_wipes_chunk_and_does_not_confirm(self):
        result, _, _, _, _, port = self.run_main(port=Port(short=True))
        self.assertEqual(result, 1)
        self.assertTrue(port.cleared)
        self.assertTrue(all(not any(chunk) for chunk in port.chunks))

    def test_usb_identity_exact_match_and_duplicates(self):
        from serial.tools import list_ports
        good = Mock(device="COM18", vid=0x303A, pid=0x1001, serial_number="PUBLIC-SERIAL")
        for devices, expected in (([good], True), ([], False), ([good, good], False)):
            with patch.object(list_ports, "comports", return_value=devices):
                self.assertEqual(host.matching_device("COM18", "PUBLIC-SERIAL"), expected)
                self.assertFalse(host.matching_device("COM18", "wrong"))
                self.assertFalse(host.matching_device("COM18", None))


if __name__ == "__main__":
    unittest.main()
