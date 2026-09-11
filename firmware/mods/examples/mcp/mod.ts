import { defineApp, EMOTIONS, type Emotion } from 'stackchan'
import { network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  async setup(app) {
    const net = network(app)
    await net.ready()
    net.serveTools({
      port: 8080,
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
            if (!EMOTIONS.includes(name as Emotion)) return `Invalid emotion. Use ${EMOTIONS.join(', ')}`
            app.face.setEmotion(name as Emotion)
            return `Emotion set to ${name}`
          },
        },
        {
          name: 'say_message',
          description: 'Speak a message',
          inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
          execute: async ({ message }, task) => {
            if (typeof message !== 'string') return 'message must be text'
            await app.audio.say(message, { signal: task.signal })
            return `Said: ${message}`
          },
        },
      ],
    })
    const endpoint = `http://${net.address() ?? 'stackchan.local'}:8080/mcp`
    ui(app).addAction({ id: 'endpoint', label: 'MCP アドレス' }, () => app.ui.showBalloon(endpoint))
    app.ui.showBalloon(endpoint)
  },
})
