import { defineApp, EMOTIONS, type Emotion, StackchanError, type TaskContext } from 'stackchan'
import { conversation } from 'stackchan/extensions/conversation'
import {
  type Connection,
  type HttpRoute,
  network,
  type SocketConnection,
  type Tool,
} from 'stackchan/extensions/network'
import { settings } from 'stackchan/extensions/settings'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    const controls = ui(app),
      chat = conversation(app),
      net = network(app)
    const setEmotion = (value: unknown) => {
      const name = typeof value === 'string' ? value.toLowerCase().replace('doubtful', 'doubt') : ''
      if (!EMOTIONS.includes(name as Emotion))
        throw new StackchanError('INVALID_ARGUMENT', `Emotion: ${EMOTIONS.join(', ')}`)
      app.face.setEmotion(name as Emotion)
      controls.setEmoticon(
        name === 'happy'
          ? 'heart'
          : name === 'angry'
            ? 'angry'
            : name === 'sad'
              ? 'tear'
              : name === 'sleepy'
                ? 'sleepy'
                : name === 'doubt'
                  ? 'sweat'
                  : null,
      )
      return `Emotion set to ${name}`
    }
    const tool: Tool = {
      name: 'set_emotion',
      description: 'Set the robot emotion',
      inputSchema: {
        type: 'object',
        properties: { emotion: { type: 'string', enum: EMOTIONS } },
        required: ['emotion'],
      },
      execute: (input) => setEmotion(input.emotion),
    }
    const dialogue = chat.dialogue({ tools: [tool] })
    let connection: Connection | undefined,
      socket: SocketConnection | undefined,
      looking = false
    let busy = false
    const answer = async (text: string, task: TaskContext, remote?: SocketConnection) => {
      if (busy) throw new StackchanError('BUSY', '会話の返事を待ってください')
      busy = true
      try {
        app.ui.showBalloon(text)
        const reply = await dialogue.ask(text, { signal: task.signal })
        const sentences = remote ? reply.split(/(?<=[。！？])/).filter(Boolean) : [reply]
        for (const sentence of sentences) {
          remote?.send(JSON.stringify({ role: 'assistant', message: sentence }))
          await app.audio.say(sentence, { signal: task.signal })
        }
        app.ui.hideBalloon()
        return reply
      } finally {
        busy = false
      }
    }
    const record = async (task: TaskContext) => {
      await net.ready({ signal: task.signal })
      await app.audio.tone(1000, { durationMs: 100, signal: task.signal })
      const recording = await app.audio.record({ signal: task.signal })
      await app.audio.tone(600, { durationMs: 100, signal: task.signal })
      await answer(await chat.transcribe(recording, { signal: task.signal }), task)
    }
    app.input.onPress('primary', record)
    controls.addAction({ id: 'record', label: '話しかける' }, record)
    controls.addAction({ id: 'greeting', label: '挨拶から会話' }, (task) =>
      answer('おはようございます', task).then(() => {}),
    )
    controls.addAction({ id: 'speech', label: '音声合成を試す' }, () =>
      app.audio.say('こんにちは。僕はスタックチャンだよ。'),
    )
    controls.addToggle({ id: 'look', label: '周りを見る', value: false }, (value) => {
      looking = value
      if (!value) app.motion.lookAway()
    })
    app.time.every(5000, () => {
      if (looking) app.motion.lookAt({ yawDeg: Math.random() * 40 - 20, pitchDeg: 0 })
    })
    controls.addChoice(
      {
        id: 'input',
        label: '外部から話しかける',
        value: 'off',
        options: [
          { value: 'off', label: '停止・マイクだけ' },
          { value: 'http', label: 'HTTP :8080' },
          { value: 'ws', label: 'WebSocket :8080' },
        ],
      },
      async (mode) => {
        await connection?.close()
        connection = socket = undefined
        if (mode === 'off') return
        await net.ready()
        if (mode === 'ws') {
          socket = net.connect({
            url: `ws://${settings(app).get('tts.host') ?? 'stackchan-base.local'}:8080`,
            onMessage: (message) => {
              let value: { role?: string; message?: string }
              try {
                value = JSON.parse(message)
              } catch {
                return
              }
              const text = value.message
              if (value.role === 'user' && typeof text === 'string')
                app.time.after(0, (task) => answer(text, task, socket).then(() => {}))
            },
          })
          connection = socket
          return
        }
        const order: Emotion[] = ['neutral', 'happy', 'sleepy', 'doubt', 'sad', 'angry', 'cold', 'hot']
        const routes: HttpRoute[] = [
          { method: 'GET', path: '/', handle: () => ({ status: 200, body: 'Hello! Stach-chan web server.' }) },
          { method: 'GET', path: '/face', handle: () => ({ status: 200, body: 'OK' }) },
          {
            method: 'POST',
            path: '/speech',
            handle: async ({ form }, task) => {
              await app.audio.say(form.say, { signal: task.signal })
              return { status: 200, body: 'OK' }
            },
          },
          {
            method: 'POST',
            path: '/chat',
            handle: async ({ form }, task) => ({ status: 200, body: await answer(form.text, task) }),
          },
          {
            method: 'POST',
            path: '/face',
            handle: ({ form }) => {
              setEmotion(order[Number(form.expression)])
              return { status: 200, body: 'OK' }
            },
          },
        ]
        for (const [method, path] of [
          ['GET', '/apikey'],
          ['GET', '/apikey_set'],
          ['GET', '/role_get'],
          ['POST', '/role_set'],
          ['GET', '/setting'],
          ['POST', '/setting'],
        ] as const)
          routes.push({ method, path, handle: () => ({ status: 501, body: 'Not Implemented' }) })
        connection = net.serve({ port: 8080, routes })
        app.ui.showBalloon(`http://${net.address() ?? 'stackchan.local'}:8080`)
      },
    )
  },
})
