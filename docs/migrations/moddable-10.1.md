# Moddable SDK 10.1.0

The firmware, typings, CI setup, Docker setup and browser compiler/simulator use
Moddable SDK **10.1.0** (upstream commit
`2d54ac4308501a03f45d4fcfe33beee45ee44ac4`). Emscripten remains **5.0.1**.
Use a separate SDK checkout when evaluating this migration so existing SDK and
ESP-IDF installations are preserved.

## Security and compatibility

The [upstream release](https://github.com/Moddable-OpenSource/moddable/releases/tag/10.1.0)
fixes a TLS 1.2 vulnerability that allowed a server to bypass some security checks.
Rebuild and update the host firmware to receive the fix. Installing a new MOD
alone does not replace the host's TLS implementation. This migration does not
establish exploitability of individual Stack-chan network paths.

The default SDK TLS implementation remains selected; experimental TLS 1.3 is
not enabled. Certificate validation and application connection options are not
relaxed. New cryptography APIs and new boards are outside this migration.

SDK 10.1 retains the default XS archive range **17.7–17.9**. Web and CLI
installation recognize 10.1.x, including the `+stackchan.2` host descriptor.
SDK 9.5 remains limited to 17.7–17.8; SDK 10.0 remains at 17.7–17.9. Unknown SDK
series remain rejected. Archive acceptance does not guarantee that a host exports
all modules or capabilities used by a MOD. The host API generation remains 2.

## Source migration

ECMA-419 IO, storage, system and network manifests now point directly to
`modules/embedded`. Audio and camera C source mappings follow the new layout;
provider tests load the corresponding SDK config and lockdown implementations.
Old forwarding manifests are no longer needed by this source tree. Unmoved
classic modules under `modules/network` and data codecs retain their locations.

The SDK's network setup no longer implicitly includes classic sockets. The host
includes the classic HTTP manifest explicitly to preserve `http` and its native
`socket` dependency for existing MODs. Fetch and WebSocket continue to use their
ECMA-419 HTTPS/WSS dependencies.

Audio sample rates are unchanged. The upstream PDM restriction to multiples of
8 kHz applies to SoCs without APLL; it is not a blanket requirement to change
Core2/CoreS3 audio to 16 kHz.

## Browser compiler

Rebuild with `cd firmware && npm run build:editor-tools`, using SDK 10.1.0 and
Emscripten 5.0.1. The generated `tools.js` is unchanged; `tools.wasm` changes.

SHA-256 of `web/editor/vendor/tools.wasm`:
`4e0c4081cf736f9facb468304bc8b8213baebe6eed3ee25e4cb45ee34cdf0d29`.

The real WASM compiler regression tests compile, inspect and install test MOD
archives against the supported firmware ranges, including 10.1 hosts. The build
does not embed the local SDK checkout path.

## Validation and hardware acceptance

Software verification commands and final CI results are recorded in the linked
[migration issue and its linked PR](https://github.com/stack-chan/stack-chan/issues/769).

Provider tests use real SDK provider/config code with hardware constructors
stubbed. Simulator/network loopback tests and successful builds do not verify
physical IO or TLS communication on ESP32.

No device flash or erase is part of this migration validation. Before release,
verify HTTPS/WSS success and certificate-error handling on Core2/CoreS3, audio
record/play/stop/reconnect, USB audio, camera, touch, IMU, SD and servo operation,
and compare startup/free heap against 10.0.2. RAM savings are not claimed.

Release impact: patch. Product versions are left for the normal release process;
the pending Changeset covers firmware and Web tools.
