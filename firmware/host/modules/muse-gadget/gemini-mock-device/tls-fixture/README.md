# Local verified-TLS TTS fixture

This is test-only. Existing HTTP fixture files and production bindings are unchanged.
No API key, user speech, external API, firewall change, certificate-verification bypass,
or system trust-store change is needed. Device volume stays zero. Do not add credentials.

## Prepare and verify (Windows, from firmware)

```powershell
$fixtureHost = Read-Host 'Private IPv4 address of the fixture host'
python host/modules/muse-gadget/gemini-mock-device/tls-fixture/prepare.py --host $fixtureHost
python host/modules/muse-gadget/gemini-mock-device/tls-fixture/verify.py
python host/modules/muse-gadget/gemini-mock-device/tls-fixture/server.py --host $fixtureHost --port 18766
```

The last command is foreground and binds only that private LAN address. Stop with Ctrl-C.
For background launch use a hidden window and retain its PID. Do not bind 0.0.0.0,
expose it publicly, or change the firewall. The script rejects non-RFC1918/non-loopback
bind addresses and requests with Authorization or x-goog-api-key headers.
`verify.py` starts and stops its own loopback server; it leaves no server running.

Generated credentials/configuration live only in ignored `.generated/`. The CA signing
key is not saved; the server leaf key stays local and is never in a manifest. The DER
public root is packaged as `fixture-ca.der`. Generation reuses the same identity for A/B
and rejects a changed host SAN rather than silently replacing certificates. Certificates
are short-lived (leaf seven days, root fourteen), so the device clock must be correct.

## Build (parent/device owner only)

In the configured WSL StopWatch SDK/ESP-IDF environment, from `firmware`:

```sh
node host/modules/muse-gadget/gemini-mock-device/tls-fixture/build.mjs burst-js
node host/modules/muse-gadget/gemini-mock-device/tls-fixture/build.mjs burst-native
# Also available: realtime-js, realtime-native
```

This test-only helper prepares the same native components as the existing fixture build
wrapper, then uses the repository `scripts/run-mcconfig.mjs` wrapper. It does not flash.
Each variant has an isolated output NAME `gemini-tls-<pacing>-<scan>`. Do not reuse a
stale same-NAME archive when changing module mappings. If using another build launcher,
pass `.generated/manifest-<pacing>-<scan>.json` and preserve its NAME/component setup.
The native mapping comes from the parent's `gemini-worker-manifest.json`; the JS control
explicitly overrides `gemini-worker-scan` with the same named `findLF` export using
`bytes.indexOf(10, offset)`. Every other code/data input is shared.

The generated main runs short and long once each, `full` pipeline only, preserving
sample-byte/count checking, avatar, mute and numeric Worker/MUSE_SINK diagnostics.
The output module remains the production resampling/sink adapter, which injects the
`Time.ticks`/`MUSE_SINK` callback. No extra audio behavior is introduced.

## Why the custom CA reaches the Worker

In the StopWatch Moddable SDK, HTTPS uses:
`embedded/network/https/client/config.js` -> `embedded/io/socket/tcp/tls/tlssocket.js`
-> `crypt/ssl/session_419.js` -> `ssl/cert` from `crypt/ssl/ssl_cert.js`.
The fixture replaces only the Worker entry mapping. Its first import registers the
public root with `CertificateManager.register(new Resource('fixture-ca.der'))`, then
its second import loads the unmodified production Worker entry via a separate alias.
Registration therefore happens inside the Worker VM, not merely in the UI VM.

`ssl_cert.js` retains default `verify=true`; it checks IPv4 SAN tag 7 against the requested
host, leaf validity using `Date.now()`, and certificate signatures/chain trust. There is
no verify=false setting. This CA is never installed in the OS or production manifests.
The installed TLS cipher list includes `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256` (0xc02f).
The server forces TLS1.2, that cipher and prime256v1. Desktop OpenSSL verification is
covered by verify.py; actual SDK handshake success still requires the parent's device test.

## Data and timing

Both modes use exactly the HTTP fixture's 5760-byte deterministic PCM payload per event
(24 kHz mono S16 = 120 ms). Short is 10 events/57600 B, long 50/288000 B. MIME is
`audio/L16;rate=24000`; each response ends with interaction.completed and valid chunk EOF.
`/burst/{short,long}` flushes as fast as possible. `/realtime/{short,long}` sends event i
at i*120ms plus repeating offsets [0,15,-10,5,-10]ms: adjacent targets are 95–135ms apart.
The first event is immediate; the last arrives at about 1.07/5.87 seconds. This is server
scheduling, not a guarantee about device callback or audible timing. The payload is
synthetic, not an acoustic continuity test.

Host verification checks exact PCM, terminal event, TLS version/cipher, unknown-root
rejection, wrong-name rejection, and realtime elapsed delivery. Initial host observations:
burst short/long 1/5ms, realtime short/long 1071/5872ms; max server gap 135ms.
No full firmware build, COM access or flash was performed by the fixture author.

## Generated mapping correction and combined run

Moddable uses the first declaration and deduplicates aliases of the same source file.
The generator now clones the local dependency-manifest graph (`.generated/chain-*`)
and replaces the original entry/scan declaration there. It makes a byte-identical
physical copy of production Worker entry for its alias. The CA is in `resources`, not
`data`, so the makefile places it in RESOURCES_DIR for `new Resource(...)`.

The combined variants run burst short, burst long, realtime short, realtime long in
that order in one image. Use `build.mjs combined-js` and `build.mjs combined-native`.
They share the certificate and generated main. Numeric trace `mode` is `full-burst`
or `full-realtime`; the run counter is 0/1 respectively. HTTP uses HTTP/1.1 explicitly.

For generation-only verification use the repository `run-mcconfig.mjs` without `-m`,
then run `python .../tls-fixture/verify-mapping.py combined-js` (or combined-native).
`--name gemini-mock-stopwatch` can check the parent's same-name generated project.
This verifies actual generated module rules, CA resource target, absence of secret files,
and freshness of the production entry copy. Combined JS/native checks both passed.

To isolate throughput from the early TCP-close race, use
`--close-delay-ms 15000` on the server. This delays only socket closure after
the terminal SSE and final HTTP chunk have already been flushed. It does not
add playable audio, change provider pacing, or force the device to wait 15 s.
The default remains immediate close to test transport correctness separately.

## Bounded endurance variant

Generate normally, then build `endurance-native`. Default server close delay must
be **0 ms**: this test includes the actual immediate-close regression.

One image runs 11 cases for reserve 1 and 3, twice with reversed reserve order:
burst short/long, realtime short/long, a 350 ms midpoint delay with catch-up,
mid-event abrupt close followed by short success, missing completion SSE followed
by short success, explicit abort after 11,520 PCM bytes followed by short success.
Then one continuous 24-second (200-event) realtime response runs with reserve 1.
Two final slow-production cases deliver 120 ms PCM every 240 ms, with reserve 1
and 3. These distinguish an unsustainable production rate from catch-up jitter.
There are 47 cases, targeting roughly 3–4 minutes; the run has a
330-second guard. Ordinary cases have 22-second lifecycle and 15-second transport
limits; the 24-second case has 45/25-second limits. RAM below 32 KiB ends the run.
The server does not persist request bodies or accept API credentials.

All output is muted. The fixture-only C checker compares **every byte before
resampling** against the exact 5,760-byte repeated pattern, including offset
across block/event boundaries. It is not a DAC/acoustic or post-resampling proof.
Existing sink diagnostics count bytes submitted at 16 kHz and native starvation.
Reserve 1/3 changes only initial reserve, so report its startup delay separately
from any throughput improvement. Expected fault/cancel cases are passes only
for provider_failed/cancelled respectively, not arbitrary errors or timeouts.
Each fault must be followed by a fresh successful request. Unexpected success, failure, corruption, or cleanup error keeps the overall result
failed, but performs one fresh short recovery request before stopping unless the
RAM/time guard or a fatal exception prevents it. Expected injected faults always
have their planned normal request next. Missing-terminal acceptance requires all
PCM decoded in the Worker, parser-level provider_failed (reason 0), and main delivery
of at least expected minus 8,192 bytes; unacknowledged slots may correctly be dropped.
Exact observed delivery remains separate from successful/full delivery.

Safe numeric records:
- case-start values: reserve, expected outcome (0 success/1 provider error/2 cancel),
  expected successful PCM bytes, free internal/PSRAM.
- case-pass/fail: received, expected, calls, elapsed, first PCM, maximum PCM gap,
  maximum UI lag, actual outcome (0 success/1 provider error/2 cancel/3 other),
  internal before/after, PSRAM before/after, internal low-water, corruption flag,
  Worker decoded PCM bytes, Worker failure reason (255 means no reported reason).
- summary: passed flag, attempted cases, passed cases, total received including
  failed/cancelled prefixes, sum of expected successful bytes, elapsed, internal
  before/after, PSRAM before/after, internal low-water.
The standard done marker remains compatible with tlsmonitor. Per-case mode
contains route/reserve/expected-outcome; run is monotonic case index.

Host-only `verify-endurance.py` confirms full 24-second-sized burst bytes,
midpoint stall, mid-event truncation, terminal omission and a following valid
response on loopback with strict TLS. It does not validate device cancellation.
