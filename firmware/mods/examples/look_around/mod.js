import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    const motion = app.motion.info
    if (motion.availability === 'unavailable') {
      app.ui.showBalloon('サーボの設定を確認してください')
      return
    }
    let running = false
    app.ui.showBalloon('ボタンで見回しを開始・停止します')
    app.input.onPress('primary', () => {
      running = !running
      if (!running) app.motion.lookAway()
      app.ui.showBalloon(running ? '見回しています。ボタンで停止します' : '見回しを停止しました')
    })
    app.time.every(5000, () => {
      if (!running) return
      app.motion.lookAt({
        yawDeg: Math.max(motion.yawDeg[0], Math.min(motion.yawDeg[1], Math.random() * 60 - 30)),
        pitchDeg: Math.max(motion.pitchDeg[0], Math.min(motion.pitchDeg[1], Math.random() * 25 - 20)),
      })
    })
  },
})
