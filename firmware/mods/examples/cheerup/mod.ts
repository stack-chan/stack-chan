import { defineApp, EMOTIONS, type Emotion } from 'stackchan'
import { type Connection, network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'
import { speeches } from './speeches_cheerup'

// This is the published STK/WebSocket wire format. SDK angles use degrees.
type PoseMessage = { yaw: number; pitch: number; emotion?: number | string; hooray?: boolean }
const SOCKET_URL = 'ws://192.168.7.112:8080'
export default defineApp({
  setup(app) {
    let connection: Connection | undefined,
      pose: PoseMessage | undefined,
      connected = false
    let hooray = false,
      pending = false,
      yaw = 0,
      pitch = 0
    const receive = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const data = value as PoseMessage
      if (!Number.isFinite(data.yaw) || !Number.isFinite(data.pitch)) return
      pose = data
      if (data.hooray && !hooray) pending = true
      hooray = !!data.hooray
    }
    ui(app).addChoice(
      {
        id: 'transport',
        label: '応援の通信',
        value: 'off',
        options: [
          { value: 'off', label: '停止' },
          { value: 'ble', label: 'Bluetooth STK' },
          { value: 'ws', label: 'WebSocket' },
        ],
      },
      async (transport) => {
        await connection?.close()
        connection = undefined
        connected = false
        pose = undefined
        pending = false
        hooray = false
        await app.motion.relax()
        if (transport === 'ble')
          connection = network(app).listenStk({
            onMessage: receive,
            onConnection: (value) => {
              connected = value
            },
          })
        if (transport === 'ws') {
          await network(app).ready()
          connection = network(app).connect({
            url: SOCKET_URL,
            onMessage: (message) => {
              try {
                receive(JSON.parse(message))
              } catch {
                app.ui.showBalloon('姿勢データを読み取れません')
              }
            },
            onState: (state) => {
              connected = state === 'connected'
            },
          })
        }
      },
    )
    app.time.every(100, async () => {
      if (!connected) {
        await app.motion.relax()
        return
      }
      if (!pose) return
      const info = app.motion.info
      if (info.availability === 'unavailable') return
      yaw = (yaw + (pose.yaw * 180) / Math.PI) / 2
      pitch = (pitch + (pose.pitch * 180) / Math.PI) / 2
      await app.motion.move(
        {
          yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], yaw)),
          pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], pitch)),
        },
        { durationMs: 100 },
      )
      const name =
        typeof pose.emotion === 'number'
          ? EMOTIONS[pose.emotion]
          : pose.emotion?.toLowerCase().replace('doubtful', 'doubt')
      if (EMOTIONS.includes(name as Emotion)) app.face.setEmotion(name as Emotion)
    })
    app.time.every(100, async () => {
      if (!pending) return
      pending = false
      const clips = Object.keys(speeches)
      await app.audio.playClip(clips[Math.floor(Math.random() * clips.length)])
    })
  },
})
