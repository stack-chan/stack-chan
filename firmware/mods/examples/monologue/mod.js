import { defineApp } from 'stackchan'
import { speeches } from './speeches_monologue.js'

export default defineApp({
  setup(app) {
    const lines = Object.entries(speeches)
    const speech = app.capabilities.get('audio.speech').availability !== 'unavailable'
    if (!speech && app.capabilities.get('audio.clips').availability === 'unavailable') {
      app.ui.showBalloon('音声の設定を確認してください')
      return
    }
    app.input.onPress('primary', async () => {
      const [name, text] = lines[Math.floor(Math.random() * lines.length)]
      if (speech) await app.audio.say(text)
      else await app.audio.playClip(name)
    })
  },
})
