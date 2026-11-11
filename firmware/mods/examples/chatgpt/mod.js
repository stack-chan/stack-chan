import WebSocket from 'WebSocket'
import { createAgent, createToolSet, OpenAIResponsesLLM } from 'stackchan/ai'
import { createVoiceScope } from 'stackchan/voice/scope'
import { runTextTurn } from 'example-text-turn'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

const STT_HOST = 'stackchan-base.local'
const MODEL = 'gpt-4o-mini'
const CONTEXT = [
  {
    role: 'system',
    content:
      'You are "スタックちゃん(Stack-chan)", the palm sized super kawaii companion robot baby. You must response in a short sentense.',
  },
  {
    role: 'assistant',
    content: 'ぼく、スタックちゃん！ねえ、お話しようよ！',
  },
]

let stop
export function onClose() {
  stop?.()
  stop = undefined
}
export function onContextCreated(robot, option) {
  // Integrate ChatGPT
  const aiPrefs = option.config.ai
  const scope = createVoiceScope()
  const agent = createAgent({
    llm: new OpenAIResponsesLLM({ apiKey: aiPrefs.token, model: aiPrefs.model ?? MODEL }),
    instructions: CONTEXT.map((item) => item.content).join('\n'),
    tools: createToolSet(),
    maxToolRounds: 0,
  })
  const state = { id: 'text-session', nextTurn: 0, history: [] }
  const reply = (text) => runTextTurn(agent, state, text, scope)
  let chatting = false
  async function chatAndSay(message) {
    if (chatting) {
      return
    }
    chatting = true
    try {
      const answer = await reply(message)
      for (const sentence of answer.split(/[。！？]/).filter(Boolean)) {
        if (scope.signal.aborted) return
        ws.send(JSON.stringify({ role: 'assistant', message: sentence }))
        await robot.audio.say(sentence)
      }
    } finally {
      chatting = false
    }
  }

  // Connect to STT server
  const ttsPrefs = option.config.tts
  const ws = new WebSocket(`ws://${ttsPrefs.host ?? STT_HOST}:8080`)
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (payload) => {
    if (payload.data != null) {
      const data = typeof payload.data === 'string' ? payload.data : String.fromArrayBuffer(payload.data)
      const { role, message } = JSON.parse(data)
      if (role === 'user') {
        void chatAndSay(message).catch((error) => trace(String(error)))
      }
    }
  })
  ws.addEventListener('close', () => {
    trace('disconnected\n')
  })

  // Event handler
  let isFollowing = false
  robot.input.button.a.onEvent = function handleButtonAEvent(event) {
    if (event.pressed) {
      trace('pressed A\n')
      trace('Look around\n')
      isFollowing = !isFollowing
    }
  }
  robot.input.button.b.onEvent = function handleButtonBEvent(event) {
    if (event.pressed) {
      trace('pressed B\n')
      trace('Chat test\n')
      chatAndSay('おはようございます').catch((error) => trace(`chat failed: ${error}\n`))
    }
  }
  robot.input.button.c.onEvent = function handleButtonCEvent(event) {
    if (event.pressed) {
      trace('pressed C\n')
      trace('TTS test\n')
      sayGreeting().catch((error) => trace(`greeting failed: ${error}\n`))
    }
  }

  async function sayGreeting() {
    if (chatting) {
      return
    }
    chatting = true
    try {
      await robot.audio.say('こんにちは。ぼくｽﾀｯｸﾁｬﾝ！')
      if (!scope.signal.aborted) await robot.audio.say('よろしくね。')
    } finally {
      chatting = false
    }
  }

  // Look around
  const lookAround = () => {
    if (!isFollowing) {
      robot.motion.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.motion.lookAt([x, y, z])
  }
  const timer = Timer.repeat(lookAround, 5000)
  stop = () => {
    scope.abort()
    Timer.clear(timer)
    ws.close()
  }
}
