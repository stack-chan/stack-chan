# Private Wi-Fi replacement

Build with `node scripts/build-muse-native-device.mjs --wifi-provision` from firmware. Flash only the verified app partition, never the partition table or NVS.

`host.py` requires the expected port and USB serial number through `--port` and `--usb-serial`, and reads the settings from a non-echo TTY. Enter `CANARY` first to test without storage or Wi-Fi. An approved real update is a JSON object containing only ssid and password, supplied through the hidden prompt, never command arguments or files. No values are printed.

A valid Muse account is restored inside native RAM, its Wi-Fi fields alone replaced, and its blob committed with readback verification. Access/refresh tokens and SDK token storage are unchanged. Only an absent account falls back to alloywifi. Invalid or unreadable accounts fail closed. Commit errors can mean an indeterminate write; do not claim rollback. The two fallback keys are not guaranteed power-loss atomic.

After saving, Moddable owns the Wi-Fi interface lifecycle. Native code passes the private fields to the existing station driver with RAM-only Wi-Fi driver storage, then clears the staging buffers. CONNECTED means association and IP acquisition, not Internet or Muse authentication. The probe disconnects and releases all owned resources afterward. Restore the normal setup app when finished.

The parser rejects embedded NUL, excessive depth, unknown fields and invalid lengths. Known JSON allocations are wiped; cJSON parse-error temporaries and Python immutable strings are not a forensic-zeroization guarantee. This device uses the previously disclosed unencrypted NVS configuration.

Validation: native account tests protect token/version invariants; run-wire-test.sh checks parsing and wiping with public fixtures; main.test.mjs checks the Moddable lifecycle and failure paths. On-device canary and approved replacement both passed; the saved account updated and IP acquisition succeeded on 2026-11-15. No real values are retained in tests or this document.
