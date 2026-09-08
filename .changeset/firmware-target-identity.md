---
"stack-chan": patch
"stackchan-web": patch
---

Share canonical board identities and build capabilities across the host, CLI, firmware bundles, WebSerial and simulator. Record the board in firmware descriptors, reject incompatible MODs before overwriting the installed application, and check the board again before evaluating an installed MOD. Named-device installs ask users to update hosts that do not yet expose their board identity. MOD removal remains available for recovery.

Validate built images before host flashing even when the build tool returns success. Package the existing body font as a one-bit atlas to retain the full character repertoire within the 4MB M5Stack partition.
