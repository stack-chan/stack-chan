import { defineApp } from 'stackchan'

export default defineApp({
  async setup(app) {
    await app.audio.tone(440, { durationMs: 200, volume: 0.3 })
    app.face.setEmotion('happy')
  },
})
