---
"stack-chan": patch
---

Restore the physical Local Peer transport bindings in the M5StackChan CoreS3 host. Its board-specific manifest previously selected an empty simulator registry, causing MediaPipe BLE to stop before advertising with `ble local peer transport is not supported`. Keep the existing low-latency Wi-Fi power policy.
