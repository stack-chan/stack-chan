import { HttpServerService, Response } from 'http-server-service'
import { ChatGPTDialogue } from 'dialogue-chatgpt'
import { randomBetween, asyncWait, loadPreferences } from 'stackchan-util'
import config from 'mc/config'
import { createBalloonDecorator, createBubbleDecorator } from 'decorator'

//
// Face parameters
//
const bubble = createBubbleDecorator({
  x: 10,
  y: 20,
  width: 50,
  height: 60,
})

const EMOTIONS = ['NEUTRAL', 'HAPPY', 'SLEEPY', 'DOUBTFUL', 'SAD', 'ANGRY', 'COLD', 'HOT']

//
// Integrate ChatGPT
//

// const MODEL = 'gpt-4'
const MODEL = 'gpt-3.5-turbo'
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

const aiPrefs = loadPreferences('ai')
trace(`ai.token: ${aiPrefs.token}\n`)

const dialogue = new ChatGPTDialogue({
  apiKey: aiPrefs.token,
  model: MODEL,
  context: CONTEXT,
})

let chatting = false
async function chatAndSay(robot, message) {
  if (chatting) {
    return 'お話中です'
  }
  chatting = true
  robot.showBalloon('Now thinking...')
  const result = await dialogue.post(message)
  if (!result.success) {
    trace(`failed: ${result.reason}`)
    chatting = false
    return '問題が発生しました'
  }

  //const messages = result.value.split(/[。！？]/).filter((m) => m.length > 0)
  //for (const message of messages) {
  //  trace(message)
  //  trace('\n')
  //  await robot.say(message)
  //}
  trace(result.value)
  trace('\n')
  robot.hideBalloon()
  await robot.say(result.value)
  chatting = false
  return result.value
}

function onRobotCreated(robot) {
  robot.button.a.onChanged = async function () {
    if (this.read()) {
      robot.showBalloon('TTS test...')
      await robot.say('TTSテスト。TTSテスト')
      robot.hideBalloon()
    }
  }
  robot.button.b.onChanged = async function () {
    if (this.read()) {
      await chatAndSay(robot, 'おはようございます')
    }
  }

  const server = new HttpServerService()

  server.post('/speech', async (c) => {
    const formData = await c.req.formData()
    const say = formData.say
    const lang = formData.lang
    await robot.say(say)

    return c.text('OK')
  })

  server.post('/chat', async (c) => {
    const formData = await c.req.formData()
    const text = formData.text
    const lang = formData.lang
    const response = await chatAndSay(robot, text)
    return c.text(response)
  })

  server.get('/face', async (c) => {
    return c.text('OK')
  })

  server.post('/face', async (c) => {
    const formData = await c.req.formData()
    const expression = Number(formData.expression)
    const emotion = EMOTIONS.at(expression)
    robot.setEmotion(emotion)

    if (emotion === 'SLEEPY') {
      robot.renderer.addDecorator(bubble)
    } else {
      robot.renderer.removeDecorator(bubble)
    }

    return c.text('OK')
  })

  server.get('/apikey', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.get('/apikey_set', async (c) => {
    const formData = await c.req.formData()
    const { openai, sttapikey, voicetext, voicevox } = formData

    return c.text('Not Implemented', 501)
  })

  server.get('/role_get', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.post('/role_set', async (c) => {
    const role = await c.req.text()
    return c.text('Not Implemented', 501)
  })

  server.get('/setting', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.post('/setting', async (c) => {
    const formData = await c.req.formData()
    const volume = Number(formData.volume)
    return c.text('Not Implemented', 501)
  })

  server.get('/', async (c) => {
    return c.text('Hello! Stach-chan web server.')
  })
}

export default {
  onRobotCreated,
}
