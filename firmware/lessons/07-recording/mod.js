import { defineApp, StackchanError } from 'stackchan'

export default defineApp({
  setup(app) {
    if (
      app.capabilities.get('audio.recording').availability === 'unavailable' ||
      app.capabilities.get('audio.playback').availability === 'unavailable'
    ) {
      app.ui.showBalloon('この機種では録音と再生を使えません')
      return
    }
    app.ui.showBalloon('ボタンを押すと3秒録音して再生します')
    app.input.onPress('primary', async (task) => {
      try {
        app.ui.showBalloon('録音しています。話しかけてください')
        const audio = await app.audio.record({ durationMs: 3000, signal: task.signal })
        app.ui.showBalloon('録音した音を再生しています')
        await app.audio.play(audio, { volume: 0.5, signal: task.signal })
        app.ui.showBalloon('もう一度ボタンを押すと録音できます')
      } catch (error) {
        if (error instanceof StackchanError && (error.code === 'CANCELLED' || error.code === 'CLOSED')) return
        app.ui.showBalloon('録音・再生できませんでした。マイクの接続と使用許可を確認してください')
      }
    })
  },
})
