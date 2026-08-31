# Stack-chan Mini Games Gallery package

This package exposes one archive and one Gallery card for `Stack-chan JUMP` and `Stack-chan CATCH`.
The archive registers both games in the mini-app launcher.

`miniapp/` is the browser-visible copy of `firmware/mods/examples/stackchan_minigames/` build inputs. The Gallery test requires its manifest, generated source, documentation, sprites, and license to stay byte-for-byte identical.

`stackchan-minigames.xsa` targets XS 17.8.0 and is built with Moddable SDK 9.0.0 for the M5StackChan CoreS3 profile. The same archive runs in the Web simulator.
