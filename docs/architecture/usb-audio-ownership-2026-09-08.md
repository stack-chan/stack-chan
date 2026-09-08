# USB audio ownership and recovery — 2026-09-08

USB conversation now acquires the same duplex audio reservation whether it starts automatically or through the SDK. Admission belongs to Dock activation; the SDK facade no longer acquires a second reservation. A second active conversation returns `BUSY`.

The USB transport and EVENT runtime retain host lifetime, including pre-activation task snapshots. Audio is disabled until activation. The worker protocol returns `BUSY` for input/output start while disabled and keeps EVENT available. Activation failure rolls back audio admission together with presentation and remote-session resources.

Deactivation invalidates the generation before closing the main VM's AudioIn and AudioOut, then releases the shared reservation. Both directions of worker messages carry the generation. Old open, close, completion, input ACK, and presentation messages cannot operate a new stream, including one that reuses a stream ID. A native stop/close exception latches the common audio failure. A drain whose release fails reports `audio-failed`, not playback completion; the activation close rejects and the host must restart before reusing audio.

Verification:

- Node: 568 passing, including 100 manual activations with contention and rollback, plus automatic activation using the same admission.
- SDK strict types and 77 architecture checks passing.
- XS: the production main bridge is exercised with native I/O fakes for 100 alternating input/output activations, late requests, stale close, and release failure. The real worker routing and USB protocol run in XS with queued message/serial fakes to verify generation tagging, stale ACK rejection, inactive BUSY, and retained EVENT traffic. The protocol test repeats media admission 100 times.
- The regression was reproduced against the previous main bridge: an inactive bridge opened one audio device instead of none.
- All 59 Moddable/XS manifests passed: 57 in the complete run, and the two USB fixtures in a focused rerun after correcting their test-only TypeScript assertions (5.3 seconds).
- M5Stack release: 3,799,632 / 3,801,088 bytes (`9.5.0+stackchan.9.m5`). Standard M5StackChan CoreS3 and the dedicated USB auto-start host: 6,584,272 / 16,318,464 bytes (`9.5.0+stackchan.9.sc3`). WASM build passed. After rebuilding Web, Chromium loaded and exercised `01-face` and `03-input` against that WASM host.

These are software and build results. The tests execute worker routing in XS with a queued-message fixture; they do not establish scheduling behavior of separate native worker threads. No board was flashed. Android USB reconnect, real audio latency/drain, electrical behavior, radio coexistence, and power-loss acceptance still require physical devices.
