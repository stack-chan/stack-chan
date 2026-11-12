import DefaultBehavior from 'app-default-behavior'
import { Emoticon } from 'effects/emoticon'
import { Emotion, EmotionNames, emotionFromName } from 'face-state'
import Modules from 'modules'
import { Behavior, Container, Label, Skin, Style } from 'piu/MC'
import { adaptRobotCamera, createAgent, createToolSet, createVision, OpenAIResponsesLLM } from 'stackchan/ai'
import {
  createCascadedConversation,
  createConversationPipeline,
  createPushToTalk,
  createVoiceScope,
} from 'stackchan/voice'
import { createOpenAISpeechTTS, createWhisperSTT } from 'stackchan/voice/speech'

let stop

class TalkButtonBehavior extends Behavior {
  onCreate(_content, onEvent) {
    this.onEvent = onEvent
  }
  onTouchBegan(content, id, x, y, ticks) {
    if (this.touch !== undefined || !content.active) return
    this.touch = id
    content.captureTouch(id, x, y, ticks)
    content.state = 1
    this.onEvent({ pressed: true })
  }
  onTouchEnded(content, id) {
    if (this.touch !== id) return
    this.touch = undefined
    content.state = 0
    this.onEvent({ pressed: false })
  }
  onTouchCancelled(content, id) {
    this.onTouchEnded(content, id)
  }
}

export function onClose() {
  return stop?.()
}

export function onContextCreated(robot, option) {
  DefaultBehavior.onContextCreated(robot, option)
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
  const localSpeech = option.config.tts?.type === 'sanotts'
  const usesSanoVoice = localSpeech && Modules.has('stackchan/voice/sanotts')
  let tts
  if (localSpeech) {
    tts = usesSanoVoice
      ? Modules.importNow('stackchan/voice/sanotts', true).createSanoTTS()
      : Modules.importNow('stackchan/voice/stackchan-voice', true).createStackchanVoiceTTS()
  } else {
    tts = createOpenAISpeechTTS({ apiKey: prefs.token })
  }
  const conversation = createCascadedConversation({
    agent,
    turnDetector: pushToTalk.detector,
    stt: createWhisperSTT({ apiKey: prefs.token, maxAudioBytes: 192000 + 2560 }),
    tts,
    voice: localSpeech ? 'default' : (prefs.voice ?? 'alloy'),
  })
  const scope = createVoiceScope()
  const heart = new Emoticon({ key: 'heart', left: 20, top: 20 })
  const sweat = new Emoticon({ key: 'sweat', left: 20, top: 20 })
  const button = robot.input.button?.a
  const previous = button?.onEvent
  let talkButton
  let credit
  if (usesSanoVoice) {
    const style = new Style({ font: 'k8x12-12', color: 'white', horizontal: 'center' })
    credit = new Container(null, {
      name: 'sano-voice-credit',
      left: 0,
      right: 0,
      top: 24,
      height: 32,
      skin: new Skin({ fill: 'black' }),
      contents: [
        new Label(null, {
          left: 0,
          right: 0,
          top: 0,
          height: 16,
          style,
          string: '音声：つくよみちゃんコーパス (C) 夢前黎',
        }),
        new Label(null, {
          left: 0,
          right: 0,
          bottom: 0,
          height: 16,
          style,
          string: 'https://tyc.rei-yumesaki.net/material/corpus/',
        }),
      ],
    })
    robot.ui.addEffect(credit)
  }
  let pipeline,
    opening,
    closing,
    ending,
    effect,
    inputGeneration = 0,
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
    if (ending || scope.signal.aborted) return
    const generation = inputGeneration
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
    if (!held || scope.signal.aborted || generation !== inputGeneration) return
    await (opening ?? startPipeline())
    if (held && !scope.signal.aborted && generation === inputGeneration && !closing && !recording) {
      recording = true
      face(heart, Emotion.HAPPY)
      pushToTalk.press()
    }
  }
  function endConversation() {
    if (ending) return ending
    inputGeneration++
    held = false
    if (recording) {
      recording = false
      pushToTalk.release()
    }
    ending = (async () => {
      try {
        await closePipeline()
      } finally {
        face(undefined, Emotion.NEUTRAL)
        ending = undefined
      }
    })()
    return ending
  }
  const handleButton = (event) => {
    void onButton(event).catch((error) => {
      if (!scope.signal.aborted) {
        face(undefined, Emotion.NEUTRAL)
        robot.ui.showBalloon(String(error))
      }
    })
  }
  if (button) button.onEvent = handleButton
  else {
    talkButton = new Container(handleButton, {
      name: 'ai-push-to-talk',
      width: 144,
      height: 40,
      bottom: 32,
      active: true,
      skin: new Skin({ fill: ['#263746', '#166b70'] }),
      Behavior: TalkButtonBehavior,
      contents: [
        new Label(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          style: new Style({ font: 'k8x12-12', color: 'white', horizontal: 'center' }),
          string: '押して話す',
        }),
      ],
    })
    robot.ui.addEffect(talkButton)
  }
  robot.ui.drawer.addDrawerButton({
    key: 'ai-end-conversation',
    label: '会話を終了',
    callback: () => {
      robot.ui.closeDrawer()
      return endConversation()
    },
  })
  const shutdown = async () => {
    if (button) button.onEvent = previous
    if (talkButton) {
      talkButton.active = false
      robot.ui.removeEffect(talkButton)
    }
    robot.ui.drawer.removeDrawerButton('ai-end-conversation')
    if (credit) robot.ui.removeEffect(credit)
    scope.abort()
    await endConversation()
    if (stop === shutdown) stop = undefined
  }
  stop = shutdown
}
