# Standalone StopWatch host

This target composes the shared Guruguru Muse MOD with a minimal Piu shell and the generic Conversation PCM runtime. It avoids the CoreS3-specific stack-chan application. The StopWatch audio adapter supplies SDK codec/amplifier ownership.

Build with the parent repository helper's `--host` option. The application name is `guruguru-muse-stopwatch`; building does not flash hardware. Only use the verified application partition and preserve NVS when flashing.

At boot the serial `MUSE_HOST preference_presence` JSON contains only seven boolean fields: five `muse` settings and two `wifi` settings. The Wi-Fi booleans describe the usable credential pair: a complete `wifi` pair takes priority; otherwise the approved test network in `alloywifi` is read without copying or changing either namespace. Partial pairs are never combined. Any missing Muse setting or usable Wi-Fi pair prevents all network activity. It neither creates credentials nor prints their values. With all settings present it connects the stored Wi-Fi, obtains current time through NTP, and enables the touch PTT button only after synchronization succeeds. A failed time sync does not use a fabricated timestamp.

- Hold **Hold to talk**, release to stop capture while endpointing silence continues.
- Touch **End call** to close explicitly.
- Touch other face regions to change gaze.

Only runtime `output.level` drives the mouth. Node mocks validate configuration guards and time-sync gating, not physical audio or live Muse interoperability. The screen may not contain all glyphs in a Japanese transcript because this minimal host bundles only the supplied Open Sans font.
