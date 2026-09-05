import { defineApp } from 'stackchan'

defineApp({
  setup(app) {
    app.face.setEmotion('happy')
    void app.motion.move({ yawDeg: 15, pitchDeg: -5 }, { durationMs: 300 })
    // @ts-expect-error Motion arguments name their units.
    void app.motion.move({ yaw: 15, pitch: -5 }, { duration: 0.3 })
    // @ts-expect-error Driver instances do not belong in the SDK.
    app.motion.driver
    app.input.onPress('primary', async (task) => {
      await task.sleep(100)
      await app.audio.tone(440, { durationMs: 100, signal: task.signal })
    })
    // @ts-expect-error V1 flat methods must not leak into the V2 app context.
    app.setEmotion('happy')
    // @ts-expect-error Host provider instances are not public app capabilities.
    app.audio.tts
    // @ts-expect-error Piu belongs to an explicit extension, not the basic SDK.
    app.ui.application
    // @ts-expect-error A duration needs an explicit unit at the public boundary.
    app.audio.tone(440, 100)
    // @ts-expect-error Physical button names are not portable primary inputs.
    app.input.onPress('a', () => {})
  },
})
