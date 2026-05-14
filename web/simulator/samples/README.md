# Stack-chan simulator sample MOD

`stackchan-sample-mod.xsa` is a small prebuilt Moddable MOD archive for browser-simulator smoke testing.

It was built with `mcrun -d -m` from a minimal `mod.js` that exports Stack-chan-style hooks:

```js
export default {
  onLaunch() {
    trace('[sample-mod] onLaunch from browser simulator sample\n')
    return true
  },
  async onRobotCreated(robot) {
    trace('[sample-mod] onRobotCreated from browser simulator sample\n')
    await robot.showBalloon?.('sample .xsa', { timeout: 1000 })
  },
}
```

The file is intended for exercising download/upload/persistence and launch-archive plumbing; it is not a production MOD example.
