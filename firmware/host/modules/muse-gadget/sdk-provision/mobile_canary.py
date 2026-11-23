"""Brokered public-canary receiver. Never provisions a device or starts a network."""
import argparse
import json
from pathlib import Path
import sys
import time
from mobile_envelope import OneShotEnvelope


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--envelope-file", required=True)
    args = parser.parse_args()
    path = Path(args.envelope_file)
    if path.exists():
        print("CANARY INPUT PATH ALREADY EXISTS")
        return 1
    owner = OneShotEnvelope()
    clear = bytearray()
    try:
        print(json.dumps(owner.descriptor()), flush=True)
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if path.exists():
                with path.open("rb") as source:
                    wire = source.read(4097)
                if len(wire) > 4096:
                    raise ValueError()
                clear = owner.consume(json.loads(wire))
                if clear != b"mgst_" + b"A" * 43:
                    raise ValueError()
                print("MOBILE ENVELOPE CANARY PASS", flush=True)
                return 0
            time.sleep(.25)
        print("MOBILE ENVELOPE EXPIRED")
        return 1
    except Exception:
        print("MOBILE ENVELOPE REJECTED")
        return 1
    finally:
        clear[:] = b"\0" * len(clear)
        owner.close()


if __name__ == "__main__":
    sys.exit(main())
