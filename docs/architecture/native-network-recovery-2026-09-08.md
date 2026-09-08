# Native network recovery verification — 2026-09-08

This change addresses startup ordering and malformed input at the SDK network boundary. It does not establish physical BLE/Wi-Fi coexistence or native BLE close completion.

- DNS-SD now copies TXT values at registration and update, retains the latest update while claiming a name, and publishes once when ready. A repeated ready callback cannot create a second advertisement. Closing releases advertisement, claim, and DNS in that order; late callbacks cannot recreate them.
- HTTP, MCP, and DNS-SD ports must be integers in 1–65535 before a native service or settings dependency is opened. Beacon roles and UUIDs are validated before constructing a radio.
- STK ignores malformed JSON and packets larger than 2048 bytes, reports `INVALID_ARGUMENT` through the app scope, and accepts subsequent valid messages. Close is idempotent and blocks late ready, connection, disconnection, and message callbacks.

Node tests exercise the production JavaScript with isolated native dependency fakes. The STK test performs 100 create/receive-error/recover/close cycles. These tests establish callback and ownership behavior, not RF transmission or the timing of Moddable's native BLE destructor.

Verification:

- Firmware Node: 567 passing; SDK strict types and 77 architecture checks passing.
- All 58 Moddable/XS manifests passing (34.4 seconds, incremental).
- M5Stack release: 3,799,632 / 3,801,088 bytes, descriptor `9.5.0+stackchan.9.m5`.
- M5StackChan CoreS3 release: 6,580,176 / 16,318,464 bytes, descriptor `9.5.0+stackchan.9.sc3`.

The 4 MB M5Stack has only 1,456 bytes of factory partition margin. Future host changes must pass the artifact-size guard; the remaining size margin needs improvement as part of consolidation. No board was flashed. Physical radio handoff and repeated on-device replacement remain open.
