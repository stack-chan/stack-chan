# Application API

[日本語](./api_ja.md)

Apps, Blockly output and the product default all use `defineApp({ setup(app) {} })` from `stackchan`. Start with the [lessons](../lessons/README_ja.md) and the [SDK guide](../sdk/README_ja.md). [SDK source](../sdk) is the public type contract.

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async (task) => {
      app.face.setEmotion('happy')
      await app.audio.tone(440, { durationMs: 300, signal: task.signal })
      app.ui.showBalloon('It worked!')
    })
  },
})
```

The basic context contains face, audio, motion, input, time, camera and UI operations. Use `stackchan/extensions/*` for menus, shape faces, singing, lighting, networking, conversations, settings and sensors. `stackchan/extensions/piu` owns Piu screen lifetimes.

Time is in **milliseconds**, motion angles in **degrees**, and volume/mouth openness in **0–1**. Positive yaw turns left; positive pitch points down. Motion completion distinguishes measured arrival from an estimate. Device driver radians stay inside the host.

Async operations resolve on completion and reject with `StackchanError`: `UNSUPPORTED`, `BUSY`, `INVALID_ARGUMENT`, `CANCELLED`, `CLOSED`, and other documented codes. Capabilities report `native`, `simulated` or `unavailable`. Recorded audio carries its actual encoding alongside the buffer; `say` speaks text and `playClip` plays a named resource.

AppSession owns timers, subscriptions, operations and appearance. Return or await callback work, and pass `task.signal` to operations. Use `task.sleep()` in callbacks. Closing the app cancels its work and waits for physical resources to stop.

Host API 9 removes V1 hooks, legacy Context namespaces, raw device references and executable `mod/config`. Metadata-free, schema 1 and app API 1 archives are rejected. Rebuild from SDK source with the [current MOD declaration](../../docs/specs/stackchan-mod.md). Optional `stackchan-mod.json.settings` declares managed defaults as data; saved preferences and fixed hardware settings retain precedence.

`npm run generate-apidoc` currently generates host implementation documentation for firmware contributors. Use the SDK guide and types for app development.
