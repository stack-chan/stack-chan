---
"stack-chan": patch
"stackchan-web": patch
---

Use Moddable SDK 10.0.1 for firmware, the simulator, the browser MOD compiler,
CI setup and TypeScript typings. Rebuild the bundled browser compiler with the
same SDK; the host API generation and XS 17.9 archive compatibility remain unchanged.

SDK 10.0.1 adds standard M5Stack SD pin defaults and fixes Piu drawing GC handling
and the ECMA-419 stereo AudioOut constant. Stack-chan retains its board SD overrides
and mono audio configuration. Local regression and build validation does not replace
physical-device acceptance.
