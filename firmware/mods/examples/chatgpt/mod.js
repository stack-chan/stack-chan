import WebSocket from 'WebSocket'
import { ChatGPTDialogue } from 'dialogue-chatgpt'
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

export function onContextCreated(robot, option) {
  // Integrate ChatGPT
  const aiPrefs = option.config.ai
  trace(`ai.token: ${aiPrefs.token}\n`)
  const dialogue = new ChatGPTDialogue({
    apiKey: aiPrefs.token,
    model: MODEL,
    context: CONTEXT,
  })
  let chatting = false
  async function chatAndSay(message) {
    if (chatting) {
      return
    }
    chatting = true
    const result = await dialogue.post(message)
    if (!result.success) {
      trace(`failed: ${result.reason}`)
      return
    }

    const messages = result.value.split(/[。！？]/).filter((m) => m.length > 0)
    for (const message of messages) {
      ws.send(
        JSON.stringify({
          role: 'assistant',
          message,
        }),
      )
      await robot.audio.say(message)
    }
    chatting = false
  }

  // Connect to STT server
  const ttsPrefs = option.config.tts
  const ws = new WebSocket(`ws://${ttsPrefs.host ?? STT_HOST}:8080`)
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (payload) => {
    if (payload.data != null && payload.data.length > 1) {
      const { role, message } = JSON.parse(payload.data)
      if (role === 'user') {
        chatAndSay(message)
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
    await robot.audio.say('こんにちは。ぼくｽﾀｯｸﾁｬﾝ！')
    await robot.audio.say('よろしくね。')
    chatting = false
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
  Timer.repeat(lookAround, 5000)
}
