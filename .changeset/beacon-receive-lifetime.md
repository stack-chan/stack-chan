---
"stack-chan": patch
---

Preserve the advertised beacon UUID byte order and receive-buffer offsets when parsing packets. Copy accepted advertisements while BLE starts, keep the selected role stable, and ignore native events after the connection closes.
