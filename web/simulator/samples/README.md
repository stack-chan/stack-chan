# Stack-chan simulator sample MOD

`stackchan-sample-mod.xsa` is a small prebuilt Moddable MOD archive for browser-simulator smoke testing.

The checked-in archive targets XS 17.8.2, matching the supported simulator and CoreS3 profiles.
`ui.test.mjs` checks this version so an SDK update cannot leave an incompatible sample behind.

The source uses the same public SDK and AppSession lifecycle as other apps:

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.face.setColor('primary', { r: 0x30, g: 0xe0, b: 0xff })
    app.face.setColor('secondary', { r: 0xff, g: 0x70, b: 0xd8 })
    app.ui.showBalloon('sample .xsa OK')
    trace('[sample-mod] ready\n')
  },
})
```

To rebuild it with Moddable SDK 9.5.0, use the release configuration so the
archive does not embed host-specific source paths:

```sh
cd firmware
npm run mod:build -- ../web/simulator/samples/sample-mod/manifest.json --mode=release
cp dist/bin/esp32/release/sample-mod/sample-mod.xsa ../web/simulator/samples/stackchan-sample-mod.xsa
```

The file is intended for exercising download/upload/persistence and launch-archive plumbing; it is not a production MOD example. After installing it and clicking **Restart simulator**, the face colors should change to cyan/pink and a `sample .xsa OK` balloon should appear.
