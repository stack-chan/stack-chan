---
"stack-chan": patch
"stackchan-web": patch
---

Use one settings schema for the SDK, host, Web settings and MOD installers. Reject unsupported keys, prohibited app defaults and invalid values before connecting to a device or replacing an installed MOD. Keep per-key SDK types, value normalization, saved-setting precedence and board-locked settings consistent across every path.
