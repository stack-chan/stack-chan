---
"stack-chan": major
"stackchan-web": major
---

Require SDK app API 2 and metadata schema 2. Host API 9 removes V1 hooks, raw Context namespaces, legacy motion scheduling and executable mod/config modules. CLI, SD, WebSerial, Gallery and WASM reject old archives with instructions to rebuild from SDK sources.

Declare app setting defaults as data in stackchan-mod.json; saved settings and fixed board configuration retain precedence. USB conversation apps enable their dock through the conversation.remote capability. Read each bundled audio clip's actual sample rate from its MAUD header.

Update the starter archive, public API and audio/network/Dock guides to the SDK's owned operations and connections.
