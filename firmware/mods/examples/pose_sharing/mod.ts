import { defineApp } from 'stackchan'
import { type Connection, network, type ServiceAdvertisement } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    let connection: Connection | undefined, advertisement: ServiceAdvertisement | undefined
    let target: { yawDeg: number; pitchDeg: number } | undefined
    ui(app).addChoice(
      {
        id: 'role',
        label: '姿勢を共有',
        value: 'off',
        options: [
          { value: 'off', label: '停止' },
          { value: 'send', label: '送信' },
          { value: 'follow', label: '追従' },
        ],
      },
      async (role) => {
        await connection?.close()
        connection = advertisement = undefined
        target = undefined
        await app.motion.stop()
        if (role === 'off') return
        await network(app).ready()
        if (role === 'send')
          connection = advertisement = network(app).advertiseService({
            host: 'stackchan',
            name: 'stackchan',
            serviceType: '_http._tcp',
            port: 80,
            txt: { yaw: '0.0', pitch: '0.0' },
            onError: (reason) => app.ui.showBalloon(reason),
          })
        else
          connection = network(app).discoverServices({
            serviceType: '_http._tcp',
            onService: (service) => {
              if (service.name !== 'stackchan' || service.txt.yaw === undefined || service.txt.pitch === undefined)
                return
              const yawDeg = (Number(service.txt.yaw) * 180) / Math.PI,
                pitchDeg = (Number(service.txt.pitch) * 180) / Math.PI
              if (Number.isFinite(yawDeg) && Number.isFinite(pitchDeg)) target = { yawDeg, pitchDeg }
            },
          })
      },
    )
    app.time.every(100, async () => {
      const position = app.motion.position
      if (advertisement && position)
        advertisement.update({
          yaw: String((position.yawDeg * Math.PI) / 180),
          pitch: String((position.pitchDeg * Math.PI) / 180),
        })
      const info = app.motion.info
      if (target && info.availability !== 'unavailable') {
        const next = target
        target = undefined
        await app.motion.move(
          {
            yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], next.yawDeg)),
            pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], next.pitchDeg)),
          },
          { durationMs: 100 },
        )
      }
    })
    ui(app).addAction({ id: 'look', label: '向きを変える' }, () =>
      app.motion.lookAt({ yawDeg: Math.random() * 40 - 20, pitchDeg: 0 }),
    )
  },
})
