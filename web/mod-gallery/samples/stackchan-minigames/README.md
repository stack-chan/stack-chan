# Stack-chan Mini Games Gallery package

This package exposes one archive and one Gallery card for `Stack-chan JUMP` and `Stack-chan CATCH`.
The archive registers both games in the mini-app launcher.

`source/` is generated during Vite development and production builds by `mod-gallery/canonical-sources.mjs`. It publishes the maintained firmware example without transforming its application code; only the manifest's metadata path changes. Edit `firmware/mods/examples/stackchan_minigames/` and rebuild the release archive, then copy it here. The generated source is ignored by Git.

This SDK app requires host API 3 and `ui.piu`, and uses app API 2 with the normal `mod` entrypoint.

`stackchan-minigames.xsa` targets XS 17.8.2 and is built with Moddable SDK 9.5.0 for the M5StackChan CoreS3 profile. The same archive runs in the Web simulator.
