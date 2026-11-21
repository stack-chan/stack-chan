"""Dormant operational receiver. Start only after the separate user approval."""
import argparse
import json
from pathlib import Path
import sys
import time
from mobile_envelope import OneShotEnvelope
from mobile_save import save_received


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Invalid options; never supply a credential as an argument.\n")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def receive(owner, path, save, *, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + 600
    try:
        while clock() < deadline:
            if path.exists():
                with path.open("rb") as source:
                    wire = source.read(4097)
                if len(wire) > 4096:
                    return False
                envelope = json.loads(wire, object_pairs_hook=unique_object)
                return save(owner, envelope)
            sleep(.25)
        return False
    except Exception:
        return False
    finally:
        owner.close()


def main():
    parser = SafeParser()
    parser.add_argument("--approved-save", action="store_true")
    parser.add_argument("--port", required=True)
    parser.add_argument("--expected-serial", required=True)
    parser.add_argument("--envelope-file", required=True)
    args = parser.parse_args()
    if not args.approved_save:
        print("SEPARATE USER APPROVAL REQUIRED")
        return 1
    path = Path(args.envelope_file)
    if path.exists():
        print("NEW ENVELOPE PATH REQUIRED")
        return 1
    owner = None
    try:
        import serial
        from serial.tools.list_ports import comports
        matches = [p for p in comports() if p.device == args.port
                   and p.vid == 0x303A and p.pid == 0x1001
                   and p.serial_number == args.expected_serial]
        if len(matches) != 1:
            raise ValueError()
        owner = OneShotEnvelope()
        print(json.dumps(owner.descriptor()), flush=True)
        ok = receive(owner, path, lambda key, envelope: save_received(
            key, envelope, approved=True, port_name=args.port,
            expected_serial=args.expected_serial, list_ports=comports,
            serial_factory=serial.Serial))
        print("DEVICE SDK SAVE VERIFIED" if ok else "DEVICE SDK SAVE NOT CONFIRMED", flush=True)
        return 0 if ok else 1
    except Exception:
        print("DEVICE SDK SAVE NOT CONFIRMED", flush=True)
        return 1
    finally:
        if owner is not None:
            owner.close()


if __name__ == "__main__":
    sys.exit(main())
