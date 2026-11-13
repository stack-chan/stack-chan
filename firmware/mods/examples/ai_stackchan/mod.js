import DefaultBehavior from 'app-default-behavior'
import { Emoticon } from 'effects/emoticon'
import { Emotion, EmotionNames, emotionFromName } from 'face-state'
import { Behavior, Container, Label, Skin, Style } from 'piu/MC'
import { Agent, adaptRobotCamera, OpenAIResponsesLLM, ToolSet, Vision } from 'stackchan/ai'
import { CascadedConversation, ConversationPipeline, PushToTalk, VoiceScope } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'
import Timer from 'timer'

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
  const llm = OpenAIResponsesLLM.create({ apiKey: prefs.token, model: prefs.model ?? 'gpt-4o-mini' })
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
    const vision = Vision.create({ camera: adaptRobotCamera(robot.camera), llm })
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
  const tools = ToolSet.create(registered)
  const agent = Agent.create({
    llm,
    tools,
    maxToolRounds: 4,
    instructions:
      'あなたは手のひらサイズのスタックチャンです。絵文字や読み上げ用でない記号を使わず、短い日本語のひとことで話してください。気持ちはset_emotionで顔に表してください。',
  })
  const pushToTalk = PushToTalk.create()
  const speech = OpenAISpeechTTS.create({ apiKey: prefs.token })
  const tts = {
    capabilities: speech.capabilities,
    async open(options) {
      const synthesis = await speech.open(options)
      const generation = inputGeneration
      const turnId = activeTurn
      let motion,
        closed = false
      return {
        get output() {
          return synthesis.output
        },
        write(text) {
          return synthesis.write(text)
        },
        async flush() {
          try {
            const done = synthesis.flush()
            if (!closed) motion ??= startLipMotion(options.signal, turnId, generation)
            return await done
          } catch (error) {
            motion?.stop()
            throw error
          }
        },
        async endInput() {
          try {
            const done = synthesis.endInput()
            if (!closed) motion ??= startLipMotion(options.signal, turnId, generation)
            return await done
          } catch (error) {
            motion?.stop()
            throw error
          }
        },
        async close() {
          closed = true
          motion?.stop()
          return await synthesis.close()
        },
      }
    },
  }
  const conversation = CascadedConversation.create({
    agent,
    turnDetector: pushToTalk.detector,
    stt: WhisperSTT.create({ apiKey: prefs.token, maxAudioBytes: 192000 + 2560 }),
    tts,
    voice: prefs.voice ?? 'alloy',
  })
  const scope = VoiceScope.create()
  const heart = new Emoticon({ key: 'heart', left: 20, top: 20 })
  const button = robot.input.button?.a
  const previous = button?.onEvent
  let talkButton
  let pipeline,
    opening,
    closing,
    ending,
    effect,
    lipMotion,
    previousFaceMotion,
    activeTurn,
    pendingInputs = 0,
    awaitingTurn = false,
    quiet = false,
    inputGeneration = 0,
    held = false,
    recording = false
  function face(nextEffect, emotion) {
    if (quiet) nextEffect = undefined
    if (effect !== nextEffect) {
      if (effect) robot.ui.removeEffect(effect)
      if (nextEffect) robot.ui.addEffect(nextEffect)
      effect = nextEffect
    }
    robot.face.setEmotion(emotion)
  }
  function stopLipMotion() {
    lipMotion?.stop()
  }
  function startLipMotion(signal, turnId, generation) {
    if (
      scope.signal.aborted ||
      signal.aborted ||
      !quiet ||
      activeTurn !== turnId ||
      turnId === undefined ||
      inputGeneration !== generation ||
      closing ||
      ending
    )
      return
    stopLipMotion()
    let open = false
    const motion = {
      stop() {
        if (lipMotion !== motion) return
        lipMotion = undefined
        Timer.clear(timer)
        signal.removeEventListener('abort', abort)
        robot.face.setMouthOpen(0, true)
      },
    }
    const abort = () => motion.stop()
    const timer = Timer.repeat(() => {
      if (signal.aborted || scope.signal.aborted || !quiet || activeTurn !== turnId) {
        motion.stop()
        return
      }
      open = !open
      robot.face.setMouthOpen(open ? 0.7 : 0, true)
    }, 100)
    lipMotion = motion
    signal.addEventListener('abort', abort)
    return motion
  }
  function quietPresentation() {
    if (!quiet) {
      previousFaceMotion = robot.ui.faceMotionEnabled
      quiet = true
      robot.ui.setFaceMotionEnabled?.(false)
      robot.face.setMouthOpen(0, true)
    }
    robot.ui.hideBalloon()
    face(undefined, Emotion.DOUBTFUL)
  }
  function restorePresentation() {
    stopLipMotion()
    if (quiet) {
      robot.face.setMouthOpen(0, true)
      if (typeof previousFaceMotion === 'boolean') robot.ui.setFaceMotionEnabled?.(previousFaceMotion)
      previousFaceMotion = undefined
      quiet = false
    }
    face(undefined, Emotion.NEUTRAL)
  }
  function restoreIfIdle() {
    if (!recording && !pendingInputs && !awaitingTurn && activeTurn === undefined) restorePresentation()
  }
  function closePipeline() {
    stopLipMotion()
    if (closing || !pipeline) return closing
    const target = pipeline
    closing = target
      .close({ mode: 'abort' })
      .catch((error) => {
        if (!scope.signal.aborted) robot.ui.showBalloon(String(error))
        throw error
      })
      .finally(() => {
        if (pipeline === target) {
          pipeline = undefined
          opening = undefined
        }
        closing = undefined
      })
    return closing
  }
  function startPipeline() {
    const next = ConversationPipeline.create({
      microphone: robot.audio.microphone,
      speaker: robot.audio.speaker,
      conversation,
      mediaBudget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
      onEvent(value) {
        if (pipeline !== next || scope.signal.aborted) return
        if (value.type === 'error') {
          stopLipMotion()
          const failedInput = activeTurn === undefined && pendingInputs > 0
          if (recording) {
            recording = false
            if (!value.fatal && (failedInput || activeTurn !== undefined || awaitingTurn)) {
              pendingInputs++
              quietPresentation()
            }
            pushToTalk.release()
          }
          if (value.fatal) pendingInputs = 0
          else if (failedInput) pendingInputs--
          awaitingTurn = false
          activeTurn = undefined
          restoreIfIdle()
          if (!quiet)
            robot.ui.showBalloon(value.code === 'input_overrun' ? '6秒以内で話してね' : `音声対話: ${value.code}`)
          if (value.fatal) void closePipeline()?.catch((error) => trace(String(error)))
        } else if (value.type === 'input.transcript' && value.value.final) {
          pendingInputs = Math.max(0, pendingInputs - 1)
          awaitingTurn = !!value.value.text.trim()
          restoreIfIdle()
        } else if (value.type === 'turn.started') {
          awaitingTurn = false
          activeTurn = value.turnId
          quietPresentation()
        } else if (value.type === 'turn.ended') {
          if (activeTurn === value.turnId) {
            stopLipMotion()
            activeTurn = undefined
          }
          restoreIfIdle()
        }
      },
    })
    pipeline = next
    if (robot.audio.volume !== undefined) next.setVolume(robot.audio.volume)
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
        pendingInputs++
        quietPresentation()
        pushToTalk.release()
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
    stopLipMotion()
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
        pendingInputs = 0
        awaitingTurn = false
        activeTurn = undefined
        restorePresentation()
        ending = undefined
      }
    })()
    return ending
  }
  const handleButton = (event) => {
    void onButton(event).catch((error) => {
      if (!scope.signal.aborted) {
        pendingInputs = 0
        awaitingTurn = false
        activeTurn = undefined
        restorePresentation()
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
    scope.abort()
    await endConversation()
    if (stop === shutdown) stop = undefined
  }
  stop = shutdown
}
