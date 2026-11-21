# StopWatch mock TTS

Runs the real HTTP/SSE, native Base64, PCM source, resampler and speaker path against synthetic data. No API key, microphone, Muse request or saved-setting writes. Speaker volume is zero; the DMA path and avatar still run.

1. Set `MOCK_TTS_HOST` to the server computer's LAN IPv4 address and run `python server.py`.
2. In another shell with the same variable, run `python server.test.py`. These tests check HTTP status, completion and every decoded PCM byte.
3. Run `python prepare.py http://<LAN-IP>:18765`. This derives bindings/resources from the normal setup manifest, rather than maintaining a second resource list.
4. In the configured StopWatch SDK environment, run `node scripts/build-muse-native-device.mjs --gemini-mock` from `firmware`.
5. Verify the selected board's partition table and preserve a known-good app before flashing. The author's COM18 fixture uses app offset `0x20000`; do not infer this for another board or use generated whole-device flash commands.

The fixture uses existing stored Wi-Fi only. Each audio event contains 5760 bytes of deterministic 24 kHz mono PCM. Short/long requests provide 1.2/6 seconds. It alternates decode-only/full cases over five rounds, verifies byte counts and sample boundaries, and reports numeric transport and timing counters. The suite stops on the first failure or if the internal heap low-water mark falls below 32 KiB. Follow the recovery policy for the selected board; the fixture does not restore or reflash anything.

With Worker transport diagnostics enabled, the stage-ms vector aggregates five times per request, in milliseconds: SSE text/framing, JSON parsing, Base64 prechecks, native Base64 decoding, and PCM output including credit waits. Network callbacks, byte buffering, startup, and final drain can fall outside those stages.

These are diagnostic numbers, not a WebSocket-vs-HTTP winner comparison. TLS, provider latency and concurrent microphone/LLM work are absent. HTTP consume time includes downstream backpressure. Completion does not prove audible continuity; no audio recording is made.

With bounded Worker read-ahead, transport record 4 reports: HTTP status, bytes owned, elapsed ms, total ms and maximum interval waiting for a readable callback after the consumer queue emptied, maximum interval between readable callbacks, peak queued bytes, peak queued chunks, and bytes still unread at the first SDK termination notice. This measures socket callbacks on the device, not server send timestamps. Only a complete application terminal event can turn a socket error into success.

Record 5 reports SSE framing, JSON, Base64 prechecks, native decoding, and PCM offer time (ms), followed by the number of full Worker-credit waits, their total and maximum duration (ms), and maximum interval between shared PCM slot posts (ms). PCM offering already includes credit waits; do not add these overlapping times.
