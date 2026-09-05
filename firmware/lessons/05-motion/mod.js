import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    const motion = app.motion.info
    if (motion.availability === 'unavailable') {
      app.ui.showBalloon('サーボの設定を確認してください')
      return
    }
    app.ui.showBalloon('ボタンを押すと首を動かします')
    app.input.onPress('primary', async (task) => {
      await app.motion.move({ yawDeg: 15, pitchDeg: 0 }, { durationMs: 350, signal: task.signal })
      await app.motion.move({ yawDeg: -15, pitchDeg: 0 }, { durationMs: 350, signal: task.signal })
      const result = await app.motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 350, signal: task.signal })
      app.ui.showBalloon(result.completion === 'measured' ? '首の到達を確認しました' : '首の動作指令が完了しました')
    })
  },
})
