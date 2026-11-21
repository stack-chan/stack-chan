# StopWatch audio adapter

This manifest is for the `m5stack_stopwatch` target at Moddable commit
`69158293` only. It does not modify the SDK or generic Conversation runtime.

`audio-in` resolves to `device.audio.Input`. The existing generic runtime's
`stackchan/voice/cores3-pcm-output` optional hook resolves to this target's
output adapter; the historical hook name does not imply CoreS3 hardware.
The host must still include `modules/pins/i2s/manifest.json`, because the
generic runtime resolves that fallback module even when using the direct hook.

The SDK's StopWatch provider owns ES8311 initialization, codec power, and
amplifier GPIO14 / expander10. Raw embedded AudioIn or classic pins/audioout
alone bypass those steps. The setup target initially disables codec power.

The output adapter uses the provider's synchronous `Output` and `onWritable`
credit. It immediately fills available native space instead of waiting for an
Async completion for every block. Native writes copy input before returning;
credit reports space, not physical playback. The SDK configures 4,092-byte DMA
descriptors, six descriptors, and five descriptors of writable credit. To drain,
the adapter flushes its partial stage, then writes seven descriptors of silence.
Padding is excluded from frame counts. Review these constants on SDK updates.
This is a conservative drain, not a hardware sample-position measurement.

Logical queued PCM is bounded by the runtime budget. The SDK additionally
allocates its fixed DMA ring and staging storage; this is not included in the
logical media queue limit. No microphone samples are logged or retained by the
smoke test: it reports sample count, nonzero count, peak, and RMS only.

The independent `../__tests__/audio-device/manifest.json` tests one-second
capture, a low-volume 100 ms tone, drain, release, and reacquisition. A successful
build alone does not prove physical microphone or speaker operation.

## Device smoke verification

The coordinating agent ran the standalone smoke test on the StopWatch on
2026-11-15 and reported:

- One-second capture: 16,384 samples, 973 nonzero samples, peak 227, RMS 9.
- 100 ms tone: 1,600 frames, playback receipt `played`.
- `MUSE_AUDIO_RELEASE_REACQUIRE_PASS` after closing and reacquiring the device.

This verifies microphone callbacks with nonzero PCM, output submission/drain,
and ownership release/reacquisition on the device. It does not establish audible
speaker quality, microphone intelligibility, or a successful remote conversation.
No raw microphone recording was retained.

## Short-write pacing

MP3 frames may produce only 24 ms of PCM, while the SDK Async queue is serviced
at a 4,092-byte DMA callback cadence. Awaiting every short write starved output.
The adapter owns one 4,092-byte staging block, copies accepted input into it,
and waits only when sending a full block. `drain()` sends its partial tail,
then reuses the same block for silence. Close discards unsubmitted staging.
The input remains borrowed only until `write()` has copied or submitted it.
This adds bounded storage, not an unbounded queue or a second worker.

## Credit and PCM audit

A no-UI device diagnostic of the preceding Async implementation observed 46 DMA
callbacks, 46 writable-capacity saturations, 46 native writes (188,232 bytes), no
partial native writes, and a 256 ms maximum write gap. Saturation indicates
missing queue headroom, not by itself proof of audible underrun. The synchronous
adapter's host regression verifies five blocks can be supplied before waiting
for hardware credit. Audible quality still requires device testing.

The native MP3 decoder retains one decoder state for the reply and copies mono
samples into the player's output buffer. The player verifies consumed bytes,
retains resampler phase/previous-sample state, and waits for PCM acceptance
before reusing its conversion buffer. PCM and staging boundaries are even.
A host comparison of 24 kHz to 16 kHz resampling with chunk sizes 1, 2, 575,
576, 577, and 1,152 matched a continuous conversion exactly (30,720 output
samples). This verifies the matching host algorithm, not native audio quality.
Native decode errors can become zero-sample frames; zero frames after the first
successful frame should be counted separately from output starvation.

SDK sources reviewed: `guides/implement419/callbacks.md`,
`examples/io/audioout/play-sync/main.js`, `examples/io/audioout/play-async/main.js`,
`documentation/base/worker.md`, and
`modules/embedded/io/audio/out/esp32/audioout-esp32.c`. Volume 0 and 0.25 use the
same native scaling/copy path; only unity volume has the direct-copy fast path.
The correction changes buffer scheduling, not decoder threading. Worker/C
migration should follow measured decode/UI stalls rather than substitute for
correct credit handling.
