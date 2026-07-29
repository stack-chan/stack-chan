# Stack-chan JUMP Gallery package

`miniapp/` is the browser-visible copy of `firmware/mods/examples/mini_app_sample/`.
The MOD Gallery test requires its source, sprite, and license files to stay byte-for-byte identical.

`stackchan-jump.xsa` targets XS 17.8.0 and is built with Moddable SDK 8.3.1 for the
M5StackChan CoreS3 profile. The same archive runs in the Web simulator.

The archive contains the `miniapp` entrypoint and requires firmware that includes
the experimental mini-app host introduced by stack-chan pull request #562.
