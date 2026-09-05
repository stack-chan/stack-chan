import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async () => {
      app.face.setEmotion('happy')
      await app.audio.tone(660, { durationMs: 200 })
      app.face.setEmotion('neutral')
    })
  },
})
