import { defineApp } from 'stackchan'

defineApp({
  setup(app) {
    app.face.setEmotion('happy')
    void app.motion.move({ yawDeg: 15, pitchDeg: -5 }, { durationMs: 300 })
    // @ts-expect-error Motion arguments name their units.
    void app.motion.move({ yaw: 15, pitch: -5 }, { duration: 0.3 })
    // @ts-expect-error Driver instances do not belong in the SDK.
    app.motion.driver
    void app.camera.capture({ width: 176, height: 144, format: 'rgb565le' }).then((image) => {
      app.ui.showImage(image)
      // @ts-expect-error Native frame handles never escape through the public image.
      image.close()
    })
    // @ts-expect-error Native lifecycle belongs to the host.
    app.camera.start()
    // @ts-expect-error YUV is not a portable SDK image format.
    app.camera.capture({ format: 'yuv422' })
    app.input.onPress('primary', async (task) => {
      await task.sleep(100)
      await app.audio.tone(440, { durationMs: 100, signal: task.signal })
      const audio = await app.audio.record({ durationMs: 3000, signal: task.signal })
      await app.audio.play(audio, { volume: 0.5, signal: task.signal })
      const mimeType: string = audio.mimeType
      const filename: string = audio.filename
      void mimeType
      void filename
      // @ts-expect-error Recording bytes do not expose native input handles.
      audio.close()
    })
    // @ts-expect-error V1 flat methods must not leak into the V2 app context.
    app.setEmotion('happy')
    // @ts-expect-error Host provider instances are not public app capabilities.
    app.audio.tts
    // @ts-expect-error Piu belongs to an explicit extension, not the basic SDK.
    app.ui.application
    // @ts-expect-error A duration needs an explicit unit at the public boundary.
    app.audio.tone(440, 100)
    // @ts-expect-error Recording time also names its unit.
    app.audio.record(3000)
    // @ts-expect-error Encoded audio needs format metadata.
    app.audio.play(new ArrayBuffer(44))
    // @ts-expect-error Physical button names are not portable primary inputs.
    app.input.onPress('a', () => {})
  },
})
