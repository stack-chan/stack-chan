---
"stack-chan": patch
"stackchan-web": patch
---

Use Moddable SDK and typings 10.0.2 for firmware, CI, the simulator and the
browser MOD compiler. Rebuild the browser compiler with Emscripten 5.0.1.
The host API generation and XS 17.9 archive compatibility remain unchanged.

Use the SDK's new network module locations and explicitly retain application
network dependencies. Include HTTP server routes only in projects that use them;
Stack-chan's HTTP/MCP handlers and WebSocket clients remain available. Keep
TextEncoder and TextDecoder available to existing MODs independently of the
HTTP route manifests.

Fix package MOD builds to resolve board manifests independently of the package
directory, preserve case-sensitive paths, and locate archives using the package
name. Add CPU regression coverage for package errors, HTTP, WebSocket and
network audio streaming.
