import config from 'mc/config'
import { ChatService } from 'chat'
import { ImageFace } from 'behaviors/face'
import { SpeechBalloon } from 'effects/speech-balloon'
import { Emotion } from 'face-context'
import Timer from 'timer'

const DEFAULT_MOUTH_SCALE = 1 / 2000
const BALLOON_CHAR_WIDTH_PX = 8
const BALLOON_TEXT_PADDING_X = 18
const MAX_TRANSCRIPT_LINES = 2
const BALLOON_FIXED_HEIGHT = 44
const BALLOON_UPDATE_INTERVAL_MS = 100
const MOUTH_UPDATE_INTERVAL_MS = 40
const MOUTH_QUANTIZE_STEP = 0.1

export function onRobotCreated(robot) {
  const chatConfig = {
    ...config.chat,
    instructions: config.chat?.instructions ?? 'あなたは丁寧なアシスタントロボットです。',
  }
  if (!chatConfig?.specifier) {
    trace('[chat_audioio] config.chat.specifier is missing. Chat disabled.\n')
    return
  }

  const tools = {
    set_emotion: {
      name: 'set_emotion',
      description: "Set the robot's emotion",
      parameters: {
        type: 'object',
        properties: {
          emotion: {
            type: 'string',
            description: `Emotion to set for the robot. One of: ${Object.keys(Emotion).join(', ')}`,
          },
        },
        required: ['emotion'],
      },
      execute: async ({ emotion }) => {
        if (typeof emotion === 'string' && emotion in Emotion) {
          robot.setEmotion(Emotion[emotion])
          return `Emotion set to ${emotion}`
        }
        return `Invalid emotion: ${String(emotion)}`
      },
    },
  }

  const app = robot.renderer?.application
  robot.renderer?.setFace?.(new ImageFace({}))
  app?.distribute?.('onFaceMode', 'image')

  let active = false
  let transcriptText = ''
  let transcriptLines = ['']
  let balloon = null
  let lastState = null
  let lastBalloonText = null
  let pendingBalloonText = null
  let balloonUpdateTimer
  let pendingMouthOpen = 0
  let lastMouthOpen = 0
  let mouthUpdateTimer

  const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
  const quantizeMouthOpen = (value) => {
    const clamped = clamp01(value)
    const stepped = Math.round(clamped / MOUTH_QUANTIZE_STEP) * MOUTH_QUANTIZE_STEP
    return clamp01(stepped)
  }

  const flushMouthOpen = () => {
    if (pendingMouthOpen === lastMouthOpen) return
    lastMouthOpen = pendingMouthOpen
    robot.setMouthOpen(lastMouthOpen)
  }

  const queueMouthOpen = (value, immediate = false) => {
    pendingMouthOpen = quantizeMouthOpen(value)
    if (immediate) {
      flushMouthOpen()
    }
  }

  const startUiTimers = () => {
    if (balloonUpdateTimer === undefined) {
      balloonUpdateTimer = Timer.repeat(() => {
        flushBalloonText()
      }, BALLOON_UPDATE_INTERVAL_MS)
    }
    if (mouthUpdateTimer === undefined) {
      mouthUpdateTimer = Timer.repeat(() => {
        flushMouthOpen()
      }, MOUTH_UPDATE_INTERVAL_MS)
    }
  }

  const stopUiTimers = () => {
    if (balloonUpdateTimer !== undefined) {
      Timer.clear(balloonUpdateTimer)
      balloonUpdateTimer = undefined
    }
    if (mouthUpdateTimer !== undefined) {
      Timer.clear(mouthUpdateTimer)
      mouthUpdateTimer = undefined
    }
  }

  const ensureBalloon = () => {
    if (balloon) return
    balloon = new SpeechBalloon({
      name: 'chat-balloon',
      left: 0,
      right: 0,
      bottom: 4,
      height: BALLOON_FIXED_HEIGHT,
      font: 'k8x12-12',
    })
    robot.renderer?.addDecorator(balloon)
  }

  const getBalloonCols = () => {
    const balloonWidth = balloon?.width
    const appWidth = app?.width
    const width = balloonWidth > 0 ? balloonWidth : appWidth > 0 ? appWidth : 320
    return Math.max(1, Math.floor((width - BALLOON_TEXT_PADDING_X * 2) / BALLOON_CHAR_WIDTH_PX))
  }

  const resetTranscript = () => {
    transcriptText = ''
    transcriptLines = ['']
  }

  const appendTranscript = (text) => {
    if (!text) return
    const cols = getBalloonCols()
    if (cols <= 0) return
    for (const ch of text) {
      if (ch === '\n') {
        transcriptLines.push('')
      } else {
        const lastIndex = transcriptLines.length - 1
        const line = transcriptLines[lastIndex] ?? ''
        if (line.length >= cols) {
          transcriptLines.push(ch)
        } else {
          transcriptLines[lastIndex] = line + ch
        }
      }
      while (transcriptLines.length > MAX_TRANSCRIPT_LINES) {
        transcriptLines.shift()
      }
      if (transcriptLines.length === 0) transcriptLines.push('')
    }
    transcriptText = transcriptLines.join('\n')
  }

  const applyBalloonText = (text) => {
    ensureBalloon()
    const nextText = text ?? ''
    if (nextText === lastBalloonText) return
    lastBalloonText = nextText
    if (balloon?.delegate) {
      balloon.delegate('setText', nextText)
      return
    }
    const behavior = balloon?.behavior
    if (behavior?.setText) {
      behavior.setText(balloon, nextText)
      return
    }
    if (balloon) {
      robot.renderer?.removeDecorator(balloon)
      balloon = null
    }
    balloon = new SpeechBalloon({
      name: 'chat-balloon',
      left: 0,
      right: 0,
      bottom: 4,
      height: BALLOON_FIXED_HEIGHT,
      text: nextText,
      font: 'k8x12-12',
    })
    robot.renderer?.addDecorator(balloon)
  }

  const flushBalloonText = () => {
    if (pendingBalloonText == null) return
    const nextText = pendingBalloonText
    pendingBalloonText = null
    applyBalloonText(nextText)
  }

  const queueBalloonText = (text, immediate = false) => {
    pendingBalloonText = text ?? ''
    if (immediate) {
      flushBalloonText()
    }
  }

  const clearBalloon = () => {
    resetTranscript()
    pendingBalloonText = null
    lastBalloonText = null
    if (!balloon) return
    if (balloon.delegate) {
      balloon.delegate('clear')
      lastBalloonText = ''
      return
    }
    const behavior = balloon.behavior
    if (behavior?.clear) {
      behavior.clear(balloon)
      lastBalloonText = ''
      return
    }
    queueBalloonText('', true)
  }

  const removeBalloon = () => {
    stopUiTimers()
    if (balloon) robot.renderer?.removeDecorator(balloon)
    balloon = null
    pendingBalloonText = null
    pendingMouthOpen = 0
    lastMouthOpen = 0
    resetTranscript()
    lastState = null
    lastBalloonText = null
  }

  const onTranscript = (text, more) => {
    const chunk = text ?? ''
    if (more && chunk.length === 0) {
      resetTranscript()
      queueBalloonText('', true)
      return
    }
    appendTranscript(chunk)
    queueBalloonText(transcriptText, !more)
  }

  const chat = new ChatService({
    config: chatConfig,
    tools,
    callbacks: {
      onStateChanged: (state, error) => {
        app?.distribute?.('onChatState', state, error)
        if (state !== 'SPEAKING') {
          app?.distribute?.('onChatInputLevel', 0)
        }
        if (state !== 'LISTENING') {
          queueMouthOpen(0, true)
        }
        if (state !== lastState) {
          if (state === 'LISTENING' || state === 'SPEAKING') {
            clearBalloon()
          }
          lastState = state
        }
        if (state === 'DISCONNECTED' || state === 'FAILED') {
          active = false
          robot.application.setDrawerButtonState('toggleChat', false)
          removeBalloon()
        }
      },
      onInputLevelChanged: (level) => {
        app?.distribute?.('onChatInputLevel', level)
      },
      onOutputLevelChanged: (level) => {
        const mouthOpen = level * DEFAULT_MOUTH_SCALE
        queueMouthOpen(mouthOpen)
      },
      onInputTranscript: (text, more) => {
        onTranscript(text, more)
      },
      onOutputTranscript: (text, more) => {
        onTranscript(text, more)
      },
      onFunctionCall: async (call, name, params) => {
        const tool = tools[name]
        if (!tool?.execute) {
          chat.sendFunctionResult(call, name, `Tool not found: ${name}`)
          return
        }
        try {
          const result = await tool.execute(params ?? {})
          chat.sendFunctionResult(call, name, result)
        } catch (err) {
          chat.sendFunctionResult(call, name, String(err?.message ?? err))
        }
      },
    },
  })

  const startChat = () => {
    if (active) return
    active = true
    startUiTimers()
    robot.application.setDrawerButtonState('toggleChat', true)
    chat.setVolume(0.5)
    queueMouthOpen(0, true)
    ensureBalloon()
    clearBalloon()
    chat.start()
  }

  const stopChat = () => {
    if (!active) return
    active = false
    robot.application.setDrawerButtonState('toggleChat', false)
    chat.stop()
    queueMouthOpen(0, true)
    removeBalloon()
  }

  robot.application.addDrawerButton({
    key: 'toggleChat',
    label: 'Chat',
    kind: 'toggle',
    initialState: active,
    callback: () => {
      if (active) stopChat()
      else startChat()
    },
  })
}
