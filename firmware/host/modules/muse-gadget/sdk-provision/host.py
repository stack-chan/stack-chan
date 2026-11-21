"""Interactive USB input only: never accept a credential through argv, env, or files."""
import argparse
import getpass
import sys
import time
import warnings


def valid_token(token):
    return (len(token) == 48 and token.startswith("mgst_")
            and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for c in token[5:])
            and token[-1] in "AEIMQUYcgkosw048")


def exchange(port, payload):
    expected = b"MUSE SDK CANARY PASS" if payload == b"CANARY\n" else b"MUSE SDK SAVED"
    port.reset_input_buffer()
    port.dtr = False
    port.rts = True
    time.sleep(.1)
    port.rts = False
    response = b""
    end = time.monotonic() + 20
    while b"MUSE SDK INPUT READY" not in response.replace(b"\r\n", b"\n").split(b"\n")[:-1] and time.monotonic() < end:
        response = (response + port.read(4096))[-4096:]
    if b"MUSE SDK INPUT READY" not in response.replace(b"\r\n", b"\n").split(b"\n")[:-1]:
        return False
    response = b""
    for offset in range(0, len(payload), 24):
        chunk = bytearray(memoryview(payload)[offset:offset + 24])
        try:
            if port.write(chunk) != len(chunk):
                return False
        finally:
            chunk[:] = b"\0" * len(chunk)
        time.sleep(.04)
    end = time.monotonic() + 6
    while time.monotonic() < end:
        response = (response + port.read(4096))[-4096:]
        if expected in response.replace(b"\r\n", b"\n").split(b"\n")[:-1]:
            return True
        if b"MUSE SDK EXISTS" in response.replace(b"\r\n", b"\n").split(b"\n")[:-1] or b"MUSE SDK REJECTED" in response.replace(b"\r\n", b"\n").split(b"\n")[:-1]:
            return False
    return False


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
    parser = SafeParser(description="Send a hidden Muse SDK token to the verified StopWatch provisioning image.")
    parser.add_argument("--port", default="COM18")
    parser.add_argument("--expected-serial")
    parser.add_argument("--canary", action="store_true", help="Send a public canary; no credential input or saving.")
    args = parser.parse_args()
    payload = bytearray()
    try:
        if args.canary:
            payload.extend(b"CANARY\n")
        else:
            if not sys.stdin.isatty():
                raise RuntimeError()
            if not matching_device(args.port, args.expected_serial):
                raise RuntimeError()
            print("This saves a Muse SDK token on the connected StopWatch in muse_sdk/sdk_token.")
            print("USB transfer is plaintext; device NVS storage is not encrypted by this build.")
            print("Existing credentials will not be overwritten. No network request is made here.")
            if input("Type SAVE to continue: ") != "SAVE":
                raise RuntimeError()
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                token = getpass.getpass("Muse SDK token (hidden): ")
            if not valid_token(token):
                token = ""
                raise ValueError()
            payload.extend(("SDK:" + token + "\n").encode("ascii"))
            token = ""
        if not args.canary and not matching_device(args.port, args.expected_serial):
            raise RuntimeError()
        import serial
        with serial.Serial(args.port, 115200, timeout=.2, write_timeout=1) as port:
            ok = exchange(port, payload)
        print("CANARY PASS" if ok and args.canary else "SAVED" if ok else "RESULT NOT CONFIRMED")
        return 0 if ok else 1
    except Exception:
        print("INPUT OR DEVICE CHECK FAILED; no success confirmed")
        return 1
    finally:
        for i in range(len(payload)):
            payload[i] = 0


if __name__ == "__main__":
    sys.exit(main())
