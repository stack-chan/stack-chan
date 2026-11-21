# StopWatch: opt-in native Gemini speech synthesis

For local evaluation only. The regular StopWatch setup target, Gemini STT and OpenAI speech retain their existing transports. From the configured firmware build environment:

    node scripts/build-muse-native-device.mjs --setup-native-speech

The output target is `muse-setup-native-speech-stopwatch`; its generated binding check must pass. Building does not deploy. The firmware makes no synthetic production request on boot; a real user-initiated Gemini speech turn uses the existing provisioned credential. The opt-in route has no automatic fallback or retry via another transport.

The transport accepts only the fixed Google Interactions HTTPS endpoint. It uses the device ESP-IDF root bundle and hostname validation, does not follow redirects, and requires a valid system clock and suppressed HTTP header logs before sending. Error diagnostics must never include request/response bodies, headers, endpoints supplied by callers, or credentials.

The existing worker retains ownership of SSE validation, audio ring credits and terminal handling. The native task owns copies of request bytes and its credential, reads with a bounded queue, and has no pointer into XS memory. Its application limits are a 32 KiB upload and 4 MiB response; these are not a guarantee of total RAM usage because the TLS library also allocates memory. A cancelled or failed request must be disposable without sacrificing the following turn.

The caller observes its deadline even while the network task is inside DNS, TCP connect or TLS handshake. Before the HTTP client exposes a socket, cancellation cannot interrupt the SDK call: the native gate remains occupied until it returns. The configured five-second socket timeout is not a five-second upper bound on DNS plus handshake or on native cleanup. During established exchanges the watchdog can interrupt the current socket. A replacement request while cleanup is pending fails closed and is not automatically sent.

Before enabling by default, measure short and long replies against the current transport with the same network fixture and user-visible audio buffer. Track first audio and starvation independently. Test paced and interrupted streams, absence of completion, delayed headers, timeouts and cancellation followed by a fresh turn, certificate/hostname rejection, back-to-back segments and internal heap recovery. Do not use a real credential on a fixture host or disable peer verification.


## StopWatch fixture measurements (ESP32-S3, 2026-11-18)

The comparison used muted hardware output with the avatar active, three blocks of PCM prebuffering, and the same synthetic PCM over local TLS 1.2 AES-128-GCM. The server delivered an unpaced burst in TLS writes capped at 1,383 bytes. Each pair ran twice, reversing transport order on the second pass. The fixture used a diagnostic-only root and a synthetic key; the shipping target instead fixes the Google URL and uses the ESP certificate bundle.

| PCM duration | Existing JS TLS: accumulated supply gaps | Native: accumulated supply gaps | First output median, JS → native |
| --- | --- | --- | --- |
| 1.2 s | 235 / 227 ms | 0 / 0 ms | 1732 → 1324 ms |
| 6 s | 3033 / 3139 ms | 0 / 0 ms | 1710 → 1342 ms |

These are estimated output-supply gaps from the driver, not an acoustic recording or a Google service benchmark. Both transports delivered the expected bytes. The tests isolate a transport difference under a reproducible fragmentation load; they do not establish the record size or pacing of a real provider response. Network jitter or a provider that generates audio slower than playback can still cause interruptions.


## TLS qualification under a connected Muse session

The production target uses the official full ESP certificate bundle with cross-signed-chain verification; it does not add a Google-specific or diagnostic root. The build checks the effective SDK configuration, including absence of weak certificate or hostname verification.

A credentialless probe on the physical board made TLS handshakes only to the fixed Google host (no HTTP, key or application payload). In the loaded case the real conversation session, muted speaker lease, XS speech worker, bounded native queue and native task were present.

| Candidate | Standby | Loaded |
| --- | --- | --- |
| Original memory layout and default chain builder | Certificate verification failed | TLS setup failed (PSA insufficient memory); largest internal free block 10,240 B |
| Put PCM queue/scratch and request body in PSRAM | Certificate verification failed | TLS setup succeeded, then certificate verification failed |
| As above, enable official bundle cross-signed verification | Verified | Certificate verification still failed under allocation pressure |
| Also move producer scratch off task stack; reduce internal TLS stack from 24 to 16 KiB | Verified | Verified; 2.37 s, 21,167 B internal free with socket live, 12,384 B task stack unused |

Keys and control state stay in internal memory; the TLS allocator was not changed. The diagnostic uses no certificate bypass or automatic fallback. Recheck with a full synthetic stream as well as a handshake after changing the SDK or audio memory profile.

A cold blocking connection was tested separately: the 16 KiB-stack version still failed its first TLS setup when the warm standby probe was omitted. The qualified candidate uses a 12 KiB internal TLS task stack and creates the cancellation watchdog only after the socket becomes available. Before that point the watchdog could not interrupt the blocking SDK call anyway. Two successive independently created workers after reboot verified the Google chain in 2.35 s and 2.32 s, respectively, without a failed-allocation callback, HTTP request or credentials; measured unused TLS stack was 8,288 B in both. This is not a provider synthesis or acoustic test.

**Expiry and production qualification.** The earlier handshake timings did not test certificate expiry. With time-of-day support alone the target accepted an expired test leaf and reached HTTP. The native target therefore also requires certificate date checking. Keep device time synchronized; do not bypass date checks when the clock is unavailable.

With date checking enabled, 16 synthetic cases on the board while the Muse session was active passed. Wrong hostname, unknown issuer and expired leaf were rejected before HTTP (verified against server-side request records and synchronized device time). Short and long PCM matched the expected byte pattern with zero measured supply gaps, including fresh streams after cancellation and broken-stream cases. The isolated LAN fixture uses its own CA; no test CA is included in the normal target. Separately, two cold/fresh-worker handshakes with the official bundle on the real Google host succeeded in 2.28 and 2.27 s, without HTTP or credentials.

RAM remains worth monitoring: the sum of per-region lifetime internal-heap minima reached 2,772 B during the synthetic stress run, with 120–128 KiB free after cleanup. This is not an instantaneous free-space measurement or proof of ample headroom. Google TLS-only runs recorded a 14,716 B low-water reading and 8,256 B unused TLS task stack. Neither test qualifies live Google synthesis, acoustic continuity or long-session stability.
