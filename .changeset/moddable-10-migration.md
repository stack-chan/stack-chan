---
"stack-chan": minor
"stackchan-web": minor
---

Move the firmware host, browser MOD compiler, simulator and TypeScript typings
to Moddable SDK 10.0.0. Use the standard System API for restart, update HTTP
provider and Piu template typings, and retain the existing host API generation.

Building the current host and adopting its SDK System, Files or RoundRect
features requires SDK 10. The browser compiler and simulator build scripts
require SDK 10.0.0 and Emscripten 5.0.1. Custom TypeScript code using SDK 9.5
constructor or Piu template types may need the corresponding SDK 10 types.

The bundled compiler produces XS 17.9 archives. SDK 9.5 hosts remain recognized
only for compatible XS 17.7–17.8 archives; they reject these new 17.9 archives.
Update the host before installing newly compiled MODs. SDK 10 hosts accept XS
17.7–17.9, including patch revisions, but MODs that import new SDK modules also
require those modules in the host. Archive compatibility alone does not prove
runtime compatibility.

Retained SDK 9.5 archive acceptance is not a new build or physical-device PASS
for the SDK 10 host. Physical validation of the migrated features remains
required; this note does not claim a completed release or hardware acceptance.
