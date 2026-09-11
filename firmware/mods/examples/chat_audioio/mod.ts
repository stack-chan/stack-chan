import { defineApp, EMOTIONS, type Emotion } from 'stackchan'
import { conversation } from 'stackchan/extensions/conversation'
import { type Connection, network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    const controls = ui(app)
    let session: Connection | undefined,
      text = '',
      pending = '',
      mouth = 0,
      looking = false
    const toggle = controls.addToggle({ id: 'chat', label: 'リアルタイム会話', value: false }, async (enabled) => {
      await session?.close()
      session = undefined
      app.face.setMouthOpen(0)
      app.ui.hideBalloon()
      text = pending = ''
      mouth = 0
      if (!enabled) return
      await network(app).ready()
      session = await conversation(app).realtime({
        volume: 0.5,
        tools: [
          {
            name: 'set_emotion',
            description: 'Set the robot emotion',
            inputSchema: {
              type: 'object',
              properties: { emotion: { type: 'string', enum: EMOTIONS } },
              required: ['emotion'],
            },
            execute: ({ emotion }) => {
              const name = typeof emotion === 'string' ? emotion.toLowerCase().replace('doubtful', 'doubt') : ''
              if (!EMOTIONS.includes(name as Emotion)) return `Invalid emotion: ${name}`
              app.face.setEmotion(name as Emotion)
              return `Emotion set to ${name}`
            },
          },
        ],
        onState: (state, error) => {
          if (state !== 'listening') mouth = 0
          text = pending = ''
          if (state === 'failed' || state === 'disconnected') {
            toggle.setValue(false)
            app.face.setMouthOpen(0)
          }
          app.ui.showBalloon(error ?? state)
        },
        onTranscript: (chunk, more) => {
          if (more && !chunk) text = ''
          else text += chunk
          text = [...text].slice(-80).join('')
          pending = text
        },
        onOutputLevel: (level) => {
          mouth = Math.round(level * 10) / 10
        },
      })
    })
    app.time.every(125, () => {
      if (session) app.face.setMouthOpen(mouth)
    })
    app.time.every(300, () => {
      if (pending) {
        app.ui.showBalloon(pending)
        pending = ''
      }
    })
    controls.addToggle({ id: 'look', label: '周りを見る', value: false }, (enabled) => {
      looking = enabled
      if (!enabled) app.motion.lookAway()
    })
    app.time.every(5000, () => {
      if (looking) app.motion.lookAt({ yawDeg: Math.random() * 40 - 20, pitchDeg: 0 })
    })
  },
})
