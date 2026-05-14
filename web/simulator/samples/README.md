# Stack-chan simulator sample MOD

`stackchan-sample-mod.xsa` is a small prebuilt Moddable MOD archive for browser-simulator smoke testing.

It was built from `sample-mod/manifest.json`, whose `mod.js` exports Stack-chan-style hooks:

```js
export default {
  onLaunch() {
    trace('[sample-mod] onLaunch from browser simulator sample\n')
    return true
  },
  async onRobotCreated(robot) {
    trace('[sample-mod] onRobotCreated from browser simulator sample\n')
    robot.setColor?.('primary', 0x30, 0xe0, 0xff)
    robot.setColor?.('secondary', 0xff, 0x70, 0xd8)
    await robot.showBalloon?.('sample .xsa OK', { timeout: 1500 })
  },
}
```

To rebuild it:

```sh
cd web/simulator/samples
mcrun -d -m ./sample-mod/manifest.json
cp "$MODDABLE/build/bin/lin/mc/debug/sample-mod/mc.xsa" ./stackchan-sample-mod.xsa
```

The file is intended for exercising download/upload/persistence and launch-archive plumbing; it is not a production MOD example. After installing it and clicking **Restart simulator**, the face colors should change to cyan/pink and a `sample .xsa OK` balloon should appear.
