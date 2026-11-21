"""Owner-only hidden USB input; credentials are never accepted through arguments or files."""
import argparse
import getpass
import sys
import time
import warnings


READY = b"OPENAI KEY INPUT READY"
SAVED = b"OPENAI KEY SAVED"
CANARY = b"OPENAI KEY CANARY PASS"
REJECTED = (b"OPENAI KEY EXISTS", b"OPENAI KEY REJECTED")


def valid_token(token):
    return (isinstance(token, str) and 32 <= len(token) <= 512
            and token.startswith("sk-")
            and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
                    for c in token[3:]))


def wipe(buffer):
    buffer[:] = b"\0" * len(buffer)


def wait_for(port, expected, seconds):
    response = bytearray()
    deadline = time.monotonic() + seconds
    try:
        while time.monotonic() < deadline:
            response.extend(port.read(4096))
            if len(response) > 4096:
                wipe(response)
                return False
            while b"\n" in response:
                end = response.index(10)
                line = bytes(response[:end]).rstrip(b"\r")
                del response[:end + 1]
                if line in REJECTED:
                    return False
                if line == expected:
                    return True
        return False
    finally:
        wipe(response)


def exchange(port, payload):
    expected = CANARY if payload == b"CANARY\n" else SAVED
    port.reset_input_buffer()
    port.dtr = False
    port.rts = True
    time.sleep(.1)
    port.rts = False
    if not wait_for(port, READY, 20):
        return False
    for offset in range(0, len(payload), 24):
        chunk = bytearray(memoryview(payload)[offset:offset + 24])
        try:
            if port.write(chunk) != len(chunk):
                return False
        finally:
            wipe(chunk)
        time.sleep(.04)
    return wait_for(port, expected, 6)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Unsupported arguments. Never put credentials on the command line.\n")


def matching_device(port_name, expected_serial):
    if not expected_serial:
        return False
    from serial.tools.list_ports import comports
    matches = [p for p in comports() if p.device == port_name
               and p.vid == 0x303A and p.pid == 0x1001
               and p.serial_number == expected_serial]
    return len(matches) == 1


def main():
    parser = SafeParser(description="Privately save an OpenAI key on the verified StopWatch.")
    parser.add_argument("--port", default="COM18")
    parser.add_argument("--expected-serial", required=True)
    parser.add_argument("--canary", action="store_true", help="Public transport check; no key input or storage.")
    args = parser.parse_args()
    payload = bytearray()
    token = ""
    try:
        if not matching_device(args.port, args.expected_serial):
            raise RuntimeError()
        if args.canary:
            payload.extend(b"CANARY\n")
        else:
            if not sys.stdin.isatty():
                raise RuntimeError()
            print("This saves your OpenAI key to this StopWatch's NVS ai/token.")
            print("Existing values are never overwritten; Wi-Fi and Muse credentials are untouched.")
            print("USB transfer is plaintext. Storage uses the device's existing NVS protection.")
            print("The setup tool makes no network request and does not display or log the key.")
            if input("Type SAVE to continue: ") != "SAVE":
                raise RuntimeError()
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                token = getpass.getpass("OpenAI API key (hidden): ")
            if not valid_token(token):
                raise ValueError()
            payload.extend(b"OPENAI:")
            payload.extend(token.encode("ascii"))
            payload.extend(b"\n")
            token = ""
        if not matching_device(args.port, args.expected_serial):
            raise RuntimeError()
        import serial
        with serial.Serial(args.port, 115200, timeout=.2, write_timeout=1) as port:
            ok = exchange(port, payload)
        print("CANARY PASS" if ok and args.canary else "SAVED" if ok else "RESULT NOT CONFIRMED; storage may have changed")
        return 0 if ok else 1
    except (Exception, KeyboardInterrupt):
        print("INPUT OR DEVICE CHECK FAILED; no success confirmed, storage may have changed")
        return 1
    finally:
        token = ""
        wipe(payload)


if __name__ == "__main__":
    sys.exit(main())
