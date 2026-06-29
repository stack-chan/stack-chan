import loadPreferences from 'loadPreference'
import { ChatGPTDialogue } from 'dialogue-chatgpt'
import { Emoticon } from 'effects/emoticon'
import { Emotion, EmotionNames, emotionFromName } from 'face-state'
import Whisper from 'stt-whisper'

const heartDecorator = new Emoticon({ key: 'heart', left: 20, top: 20 })
const sweatDecorator = new Emoticon({ key: 'sweat', left: 20, top: 20 })

const INSTRUCTIONS = `
You are "スタックちゃん (Stack-chan)", the palm-sized super kawaii companion robot baby.
You must respond in a short sentence.
The sentence is speech only. Any symbols, emojis, or other non-speech characters must not be included.

**Emotions:**
You should exporess emotionswith set_emotion tool.
`

export function onRobotCreated(robot) {
  const setEmotionTool = {
    name: 'set_emotion',
    description: "Set the robot's emotion",
    inputSchema: {
      type: 'object',
      properties: {
        emotion: {
          type: 'string',
          description: `Emotion to set for the robot. One of: ${EmotionNames.join(', ')}`,
        },
      },
      required: ['emotion'],
    },
    execute: async (args) => {
      const emotion = args.emotion
      if (typeof emotion === 'string') {
        const nextEmotion = emotionFromName(emotion)
        if (nextEmotion !== undefined) {
          robot.setEmotion(nextEmotion)
          return `Emotion set to ${emotion.toUpperCase()}`
        }
      }
      throw new Error('Invalid emotion')
    },
  }

  let talking = false

  // Integrate ChatGPT and Whisper
  const aiPrefs = loadPreferences('ai')
  const dialogue = new ChatGPTDialogue({
    apiKey: aiPrefs.token,
    instructions: INSTRUCTIONS,
    tools: [setEmotionTool],
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

    async function handleError(message) {
      trace(`${message}\n`)
      talking = false
      robot.ui.removeEffect(decorator)
      robot.setEmotion(Emotion.NEUTRAL)
      await robot.say(message)
    }

    // set up recording face
    decorator = heartDecorator
    robot.ui.addEffect(decorator)
    robot.setEmotion(Emotion.HAPPY)

    // recording
    trace('start recording.\n')
    let buffer
    try {
      buffer = await robot.record()
    } catch (error) {
      trace(`recording failed: ${error.message}`)
      handleError('録音できませんでした')
      return
    }
    await robot.tone(600, 100)
    trace('end recording.\n')

    // transcription
    trace('start transcription.\n')
    result = await stt.transcribe(buffer)
    if (!result.success) {
      trace(`transcription failed: ${result.reason}`)
      handleError('聞き取れませんでした')
      return
    }
    trace(`transcription text:${result.value}\n`)

    // set up thinking dace
    robot.ui.removeEffect(decorator)
    decorator = sweatDecorator
    robot.ui.addEffect(decorator)
    robot.setEmotion(Emotion.DOUBTFUL)

    // completions
    trace('start completion.\n')
    result = await dialogue.post(result.value)
    if (!result.success) {
      trace(`completion failed: ${result.reason}`)
      handleError('わかりません！')
      return
    }
    trace(`completion text:${result.value}\n`)

    // speech
    await robot.say(result.value)
    talking = false

    // set up default face
    robot.ui.removeEffect(decorator)
    robot.setEmotion(Emotion.NEUTRAL)

    return
  }

  robot.button.a.onChanged = async function () {
    if (this.read()) {
      await robot.tone(1000, 100)
      await talk()
    }
  }
}
