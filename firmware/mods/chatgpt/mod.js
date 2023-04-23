import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import WebSocket from 'WebSocket'
import API_KEY from 'api-key'
import { TTS } from 'tts-voicevox'
import { ChatGPTDialogue } from 'dialogue-chatgpt'

const STT_HOST = 'stackchan-base.local'
const TTS_HOST = 'stackchan-base.local'

export function onRobotCreated(robot) {
  // Configure TTS
  robot.useTTS(
    new TTS({
      host: TTS_HOST,
      port: 50021,
      sampleRate: 24000,
    })
  )

  // Integrate ChatGPT
  const dialogue = new ChatGPTDialogue({
    apiKey: API_KEY,
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
      await robot.say(message)
    }
    chatting = false
  }

  // Connect to STT server
  const ws = new WebSocket(`ws://${STT_HOST}:8080`)
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (message) => {
    trace(`received: ${message.data}`)
    if (message.data != null && message.data.length > 1) {
      chatAndSay(message.data)
    }
  })
  ws.addEventListener('close', () => {
    trace('disconnected\n')
  })

  // Event handler
  let isFollowing = false
  robot.button.a.onChanged = async function handleButtonAChanged() {
    if (this.read()) {
      trace('pressed A\n')
      trace('Look around\n')
      isFollowing = !isFollowing
    }
  }
  robot.button.b.onChanged = async function handleButtonBChanged() {
    if (this.read()) {
      trace('pressed B\n')
      trace('Chat test\n')
      await chatAndSay('おはようございます')
    }
  }
  robot.button.c.onChanged = async function handleButtonCChanged() {
    if (this.read()) {
      trace('pressed C\n')
      trace('TTS test\n')
      if (chatting) {
        return
      }
      chatting = true
      await robot.say('こんにちは。ぼくｽﾀｯｸﾁｬﾝ！')
      await robot.say('よろしくね。')
      chatting = false
    }
  }

  // Look around
  const lookAround = () => {
    if (!isFollowing) {
      robot.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.lookAt([x, y, z])
  }
  Timer.repeat(lookAround, 5000)
}
