import { ChatGPTDialogue } from 'dialogue-chatgpt'
import Whisper from 'stt-whisper'
import { loadPreferences } from 'stackchan-util'
import { createHeartDecorator, createSweatDecorator } from 'decorator'

const heartDecorator = createHeartDecorator({ x: 20, y: 20 })
const sweatDecorator = createSweatDecorator({ x: 20, y: 20 })

const CONTEXT = [
  {
    role: 'system',
    content:
      'You are "スタックちゃん (Stack-chan)", the palm-sized super kawaii companion robot baby. You must respond in a short sentence.',
  },
  {
    role: 'assistant',
    content: 'ぼく、スタックちゃん！ねえ、お話しようよ！',
  },
]

export function onRobotCreated(robot) {
  let talking = false

  // Integrate ChatGPT and Whisper
  const aiPrefs = loadPreferences('ai')
  const dialogue = new ChatGPTDialogue({
    apiKey: aiPrefs.token,
    context: CONTEXT,
  })
  const stt = new Whisper({
    apiKey: aiPrefs.token,
  })

  async function talk() {
    if (talking) {
      return
    }
    talking = true
    let result
    let decorator

    // set up recording face
    decorator = heartDecorator
    robot.renderer.addDecorator(decorator)
    robot.setEmotion('HAPPY')

    // recording
    trace('start recording.\n')
    const buffer = await robot.record()
    await robot.tone(600, 100)
    trace('end recording.\n')

    // transcription
    trace('start transcription.\n')
    result = await stt.transcribe(buffer)
    if (!result.success) {
      trace(`transcription failed: ${result.reason}`)
      talking = false
      robot.renderer.removeDecorator(decorator)
      robot.setEmotion('NEUTRAL')
      await robot.say('聞き取れませんでした')
      return
    }
    trace(`transcription text:${result.value}\n`)

    // set up thinking dace
    robot.renderer.removeDecorator(decorator)
    decorator = sweatDecorator
    robot.renderer.addDecorator(decorator)
    robot.setEmotion('DOUBTFUL')

    // completions
    trace('start completion.\n')
    result = await dialogue.post(result.value)
    if (!result.success) {
      trace(`completion failed: ${result.reason}`)
      talking = false
      robot.renderer.removeDecorator(decorator)
      robot.setEmotion('NEUTRAL')
      await robot.say('わかりません！')
      return
    }
    trace(`completion text:${result.value}\n`)

    // set up speeching face
    robot.renderer.removeDecorator(decorator)
    decorator = heartDecorator
    robot.renderer.addDecorator(decorator)
    robot.setEmotion('HAPPY')

    // speech
    await robot.say(result.value)
    talking = false

    // set up default face
    robot.renderer.removeDecorator(decorator)
    robot.setEmotion('NEUTRAL')

    return
  }

  robot.button.a.onChanged = async function () {
    if (this.read()) {
      await robot.tone(1000, 100)
      await talk()
    }
  }
}
