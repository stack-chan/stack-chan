---
"stack-chan": major
"stackchan-web": major
---

Retire legacy miniapp archives and their separate loader. Migrate JUMP, CATCH and UI Playground to the SDK Piu extension using the normal mod entrypoint and app-owned screen lifecycle. These apps require host API 3; rebuild old miniapp packages with the new SDK and update the host firmware.

Consolidate the maintained game sources, remove the source concatenator, and publish Gallery source packages directly from the firmware examples. Keep both games, their artwork and licenses, touch controls, and the host AppBar Back action.
