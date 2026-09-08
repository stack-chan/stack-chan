import { defineApp } from 'stackchan'
import { maintenance, type ServoAxis } from 'stackchan/extensions/maintenance'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    const servo = maintenance(app),
      controls = ui(app)
    let axis: ServoAxis = 'pan',
      angle = 10,
      led = false
    controls.addChoice(
      {
        id: 'axis',
        label: '対象サーボ',
        value: axis,
        options: [
          { value: 'pan', label: '左右（Pan）' },
          { value: 'tilt', label: '上下（Tilt）' },
        ],
      },
      (value) => {
        axis = value as ServoAxis
      },
    )
    controls.addAction({ id: 'read', label: '角度・状態を読む' }, async () => {
      const value = await servo.read(axis)
      app.ui.showBalloon(
        `${value.axis}: ${value.angleDeg.toFixed(1)}°\noffset: ${value.offsetDeg ?? '-'}\ncurrent: ${value.current ?? '-'} velocity: ${value.velocity ?? '-'}`,
      )
    })
    controls.addAction({ id: 'move', label: '±10° 動作確認' }, async () => {
      angle = -angle
      await app.motion.move(
        { yawDeg: axis === 'pan' ? angle : 0, pitchDeg: axis === 'tilt' ? angle : 0 },
        { durationMs: 300 },
      )
    })
    controls.addAction({ id: 'relax', label: 'トルクを解放' }, () => app.motion.relax())
    if (servo.kind === 'scservo')
      controls.addAction({ id: 'calibrate', label: '現在位置を正面として保存' }, async () => {
        await servo.calibrate(axis)
        app.ui.showBalloon(`${axis} の正面位置を保存しました`)
      })
    if (servo.kind === 'dynamixel') {
      controls.addAction({ id: 'led', label: 'サーボの LED を切り替え' }, async () => {
        led = !led
        await servo.setLed(axis, led)
      })
      controls.addAction({ id: 'baud', label: '通信速度を 1 Mbps に保存' }, async () => {
        await servo.setBaudrate(1_000_000)
        app.ui.showBalloon('設定の driver.baudrate も 1000000 に合わせて再起動してください')
      })
    }
    controls.addAction({ id: 'id', label: 'ID を Pan=1 / Tilt=2 に保存' }, async () => {
      await servo.setId(axis, axis === 'pan' ? 1 : 2)
      app.ui.showBalloon(`${axis} の ID を保存しました`)
    })
    app.ui.showBalloon(`${servo.kind}\n対象軸を選び、状態を確認してください。保存は選択した操作で実行します。`)
  },
})
