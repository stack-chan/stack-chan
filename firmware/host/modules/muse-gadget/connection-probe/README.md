# Connection and synthetic probes

The default manifest uses `main.js` and does not submit audio. The normal setup
UI also requires an explicit interaction before capturing microphone audio.

Two explicit opt-in build selectors are available through
`firmware/scripts/build-muse-native-device.mjs`:

- `--note-transport`: fixed text, TTS retrieval, and a fixed synthetic voice note.
- `--note-synthetic`: the real Conversation pipeline with synthetic input and
  real MP3 decode/resample/speaker DMA at volume zero.

Both synthetic profiles include `synthetic-note.pcm`, an offline synthesized
16 kHz mono PCM16 phrase: "Hello. This is a connection test." They never open
the microphone. They reuse the saved native account and send this fixed fixture
to Muse, so run them only with permission for service testing. Diagnostic
output contains stages only, not credentials, audio, or reply text.

All probe profiles intentionally share the `muse-connection-probe` build slot.
Rebuild the selected manifest before flashing; touch the selected entry source
when switching mappings if the Moddable incremental cache retains an older
module. Flash only the app partition and restore the normal setup UI afterward.
The synthetic probes run once per boot, not once per installation.

## Audible UI performance probe

`--note-performance` is an explicit, automatic-on-boot service test. Unlike the
silent profile, it plays generated replies at volume 0.25. It uses only the
first three seconds of the offline synthetic PCM fixture, never the microphone.
The `WITH_UI` constant selects the avatar workload. Playback is driven by the
same native decoder and StopWatch output as setup. Run only with permission for
audible tests and restore the ordinary app afterward.

Upload/decode timings are opt-in callbacks, with numeric statistics only. To
reproduce DMA occupancy counters, apply `../__tests__/audioout-telemetry.patch`
to the matching Moddable checkout and build this diagnostic profile. Its macro
is absent from ordinary profiles. Restore the SDK source afterward; do not
replace other local SDK changes. Repeated identical close snapshots are not
separate runs and must not be added together.
