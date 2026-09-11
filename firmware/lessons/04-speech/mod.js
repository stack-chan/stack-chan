import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    const speech = app.capabilities.get('audio.speech')
    if (speech.availability === 'unavailable') {
      app.ui.showBalloon('音声合成の設定を確認してください')
      return
    }
    app.input.onPress('primary', async () => {
      await app.audio.say('こんにちは。スタックちゃんです。')
    })
  },
})
