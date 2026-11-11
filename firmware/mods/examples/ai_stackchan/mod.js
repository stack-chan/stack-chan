import { createAgent, createToolSet, createVision, adaptRobotCamera, OpenAIResponsesLLM } from 'stackchan/ai'
import {
  createCascadedConversation,
  createConversationPipeline,
  createPushToTalk,
  createVoiceScope,
} from 'stackchan/voice'
import { createOpenAISpeechTTS, createWhisperSTT } from 'stackchan/voice/speech'
import { Emoticon } from 'effects/emoticon'
import { Emotion, EmotionNames, emotionFromName } from 'face-state'

let stop

export function onClose() {
  return stop?.()
}

export function onContextCreated(robot, option) {
  const prefs = option.config.ai
  const llm = new OpenAIResponsesLLM({ apiKey: prefs.token, model: prefs.model ?? 'gpt-4o-mini' })
  /** @type {import('stackchan/ai').Tool[]} */
  const registered = [
    {
      definition: {
        type: 'function',
        name: 'set_emotion',
        description: 'Change the robot facial expression.',
        parameters: {
          type: 'object',
          properties: { emotion: { type: 'string', enum: EmotionNames } },
          required: ['emotion'],
          additionalProperties: false,
        },
      },
      execute({ emotion }) {
        const value = typeof emotion === 'string' ? emotionFromName(emotion) : undefined
        if (value === undefined) throw new Error('invalid emotion')
        robot.face.setEmotion(value)
        return { emotion }
      },
    },
  ]
  if (robot.camera && robot.camera.available !== false) {
    const vision = createVision({ camera: adaptRobotCamera(robot.camera), llm })
    registered.push({
      definition: {
        type: 'function',
        name: 'observe',
        description: 'Look through the robot camera to answer a question.',
        parameters: {
          type: 'object',
          properties: { question: { type: 'string' } },
          required: ['question'],
          additionalProperties: false,
        },
      },
      execute: ({ question }, context) => vision.observe({ question: String(question) }, context),
    })
  }
  const tools = createToolSet(registered)
  const agent = createAgent({
    llm,
    tools,
    maxToolRounds: 4,
    instructions:
      'あなたは手のひらサイズのスタックチャンです。絵文字や読み上げ用でない記号を使わず、短い日本語のひとことで話してください。気持ちはset_emotionで顔に表してください。',
  })
  const pushToTalk = createPushToTalk()
  const conversation = createCascadedConversation({
    agent,
    turnDetector: pushToTalk.detector,
    stt: createWhisperSTT({ apiKey: prefs.token, maxAudioBytes: 192000 + 2560 }),
    tts: createOpenAISpeechTTS({ apiKey: prefs.token }),
    voice: prefs.voice ?? 'alloy',
  })
  const scope = createVoiceScope()
  const heart = new Emoticon({ key: 'heart', left: 20, top: 20 })
  const sweat = new Emoticon({ key: 'sweat', left: 20, top: 20 })
  const button = robot.input.button.a
  const previous = button.onEvent
  let pipeline,
    opening,
    closing,
    effect,
    held = false,
    recording = false
  function face(nextEffect, emotion) {
    if (effect !== nextEffect) {
      if (effect) robot.ui.removeEffect(effect)
      if (nextEffect) robot.ui.addEffect(nextEffect)
      effect = nextEffect
    }
    robot.face.setEmotion(emotion)
  }
  function closePipeline() {
    if (closing || !pipeline) return closing
    const target = pipeline
    closing = target.close({ mode: 'abort' }).then(() => {
      if (pipeline === target) {
        pipeline = undefined
        opening = undefined
      }
      closing = undefined
    })
    return closing
  }
  function startPipeline() {
    const next = createConversationPipeline({
      microphone: robot.audio.microphone,
      speaker: robot.audio.speaker,
      conversation,
      mediaBudget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
      onEvent(value) {
        if (pipeline !== next || scope.signal.aborted) return
        if (value.type === 'error') {
          if (recording) {
            recording = false
            pushToTalk.release()
          }
          face(undefined, Emotion.NEUTRAL)
          robot.ui.showBalloon(value.code === 'input_overrun' ? '6秒以内で話してね' : `音声対話: ${value.code}`)
          if (value.fatal) void closePipeline()?.catch((error) => trace(String(error)))
        } else if (value.type === 'input.transcript' && value.value.final && !value.value.text.trim()) {
          face(undefined, Emotion.NEUTRAL)
        } else if (value.type === 'turn.ended' && !recording) {
          face(undefined, Emotion.NEUTRAL)
        }
      },
    })
    pipeline = next
    next.setVolume(robot.audio.volume)
    opening = next.start(scope).catch(async (error) => {
      await closePipeline()
      throw error
    })
    return opening
  }
  async function onButton(event) {
    held = event.pressed
    if (!held) {
      if (recording) {
        recording = false
        pushToTalk.release()
        face(sweat, Emotion.DOUBTFUL)
      }
      return
    }
    if (closing) await closing
    if (!held || scope.signal.aborted) return
    await (opening ?? startPipeline())
    if (held && !scope.signal.aborted && !closing && !recording) {
      recording = true
      face(heart, Emotion.HAPPY)
      pushToTalk.press()
    }
  }
  button.onEvent = (event) => {
    void onButton(event).catch((error) => {
      if (!scope.signal.aborted) {
        face(undefined, Emotion.NEUTRAL)
        robot.ui.showBalloon(String(error))
      }
    })
  }
  const shutdown = async () => {
    button.onEvent = previous
    scope.abort()
    face(undefined, Emotion.NEUTRAL)
    await closePipeline()
    if (stop === shutdown) stop = undefined
  }
  stop = shutdown
}
