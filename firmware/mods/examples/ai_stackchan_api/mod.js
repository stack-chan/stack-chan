import loadPreferences from 'loadPreference'
import { ChatGPTDialogue } from 'dialogue-chatgpt'
import { Emoticon } from 'effects/emoticon'
import { Emotion } from 'face-state'
import { HttpServerService } from 'http-server-service'

//
// Face parameters
//
const bubble = new Emoticon({
  key: 'sleepy',
  left: 10,
  top: 20,
  width: 50,
  height: 60,
})

const heart = new Emoticon({ key: 'heart', left: 20, top: 20 })
const angry = new Emoticon({ key: 'angry', left: 20, top: 20 })
const pale = new Emoticon({ key: 'tear', left: 20, top: 20 })
const sweat = new Emoticon({ key: 'sweat', left: 20, top: 20 })
let decorator

const EMOTIONS = [
  Emotion.NEUTRAL,
  Emotion.HAPPY,
  Emotion.SLEEPY,
  Emotion.DOUBTFUL,
  Emotion.SAD,
  Emotion.ANGRY,
  Emotion.COLD,
  Emotion.HOT,
]

//
// Integrate ChatGPT
//

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
    robot.hideBalloon()
    await robot.say('わかりません！')
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

function onContextCreated(robot) {
  robot.button.a.onEvent = async (event) => {
    if (event.pressed) {
      robot.showBalloon('TTS test...')
      await robot.say('TTSテスト。TTSテスト')
      robot.hideBalloon()
    }
  }
  robot.button.b.onEvent = async (event) => {
    if (event.pressed) {
      await chatAndSay(robot, 'おはようございます')
    }
  }

  const server = new HttpServerService()

  server.post('/speech', async (c) => {
    const formData = await c.req.formData()
    const say = formData.say
    const _lang = formData.lang
    await robot.say(say)

    return c.text('OK')
  })

  server.post('/chat', async (c) => {
    const formData = await c.req.formData()
    const text = formData.text
    const _lang = formData.lang
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
    if (emotion !== undefined) robot.setEmotion(emotion)

    if (decorator) {
      robot.ui.removeEffect(decorator)
    }

    switch (emotion) {
      case Emotion.HAPPY:
        decorator = heart
        break
      case Emotion.SLEEPY:
        decorator = bubble
        break
      case Emotion.DOUBTFUL:
        decorator = sweat
        break
      case Emotion.SAD:
        decorator = pale
        break
      case Emotion.ANGRY:
        decorator = angry
        break
      default:
        decorator = null
    }

    if (decorator) {
      robot.ui.addEffect(decorator)
    }

    return c.text('OK')
  })

  server.get('/apikey', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.get('/apikey_set', async (c) => {
    const formData = await c.req.formData()
    const { openai: _openai, sttapikey: _sttapikey, voicetext: _voicetext, voicevox: _voicevox } = formData

    return c.text('Not Implemented', 501)
  })

  server.get('/role_get', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.post('/role_set', async (c) => {
    const _role = await c.req.text()
    return c.text('Not Implemented', 501)
  })

  server.get('/setting', async (c) => {
    return c.text('Not Implemented', 501)
  })

  server.post('/setting', async (c) => {
    const formData = await c.req.formData()
    const _volume = Number(formData.volume)
    return c.text('Not Implemented', 501)
  })

  server.get('/', async (c) => {
    return c.text('Hello! Stach-chan web server.')
  })
}

export default {
  onContextCreated,
}
