import { defineApp } from 'stackchan'
import { type Connection, network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  async setup(app) {
    const client = network(app)
    let connection: Connection | undefined
    const start = async () => {
      await client.ready()
      // UnitV2 keeps this response open and delimits JSON results with |.
      connection = client.stream({
        url: 'http://unitv2.local/func/result',
        method: 'POST',
        delimiter: '|',
        timeoutMs: 5000,
        maxResponseBytes: 16_384,
        onMessage: (message) => {
          const face = JSON.parse(message).face?.[0]
          if (!face) return
          const x = face.x + face.w / 2,
            y = face.y + face.h / 2
          if (!Number.isFinite(x) || !Number.isFinite(y)) return
          const horizontal = (0.8 * (320 - x)) / 320,
            vertical = y / 480
          const info = app.motion.info
          if (info.availability === 'unavailable') return
          const yaw = (Math.atan2(horizontal, 0.8) * 180) / Math.PI
          const pitch = (-Math.atan2(vertical, Math.hypot(0.8, horizontal)) * 180) / Math.PI
          app.motion.lookAt({
            yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], yaw)),
            pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], pitch)),
          })
        },
        onError: (reason) => {
          toggle.setValue(false)
          app.motion.lookAway()
          app.ui.showBalloon(reason)
        },
      })
    }
    const toggle = ui(app).addToggle({ id: 'tracking', label: 'UnitV2 の顔を追う', value: true }, async (enabled) => {
      await connection?.close()
      connection = undefined
      app.motion.lookAway()
      if (enabled) await start()
    })
    await start()
  },
})
