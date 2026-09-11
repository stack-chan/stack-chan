---
"stack-chan": major
"stackchan-web": major
---

Share typed setting definitions and validation between firmware and Web configuration. Resolve host settings once for Wi-Fi boot and device composition, preserve hardware driver locks, and restrict Wi-Fi defaults to host configuration and saved credentials.

Validate complete batches before persistence, preserve decimal values, recover attempted writes on storage errors, and redact passwords and tokens from configuration notifications. Device setup uses the same service and saves Wi-Fi credentials together.

Introduce bounded, framed BLE settings protocol 2 with save acknowledgements and explicit application timing. Use matching Web tools with the new firmware. The updated Web tools preserve untouched secrets and derive available setting choices from the firmware contract. Unknown setting keys and invalid values are rejected; MOD-provided Wi-Fi defaults are no longer used.
