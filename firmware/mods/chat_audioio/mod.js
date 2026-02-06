import config from 'mc/config'
import { ChatService } from 'chat'
import { SpeechBalloon } from 'effects/speech-balloon'
import { Emotion } from 'face-context'

const DEFAULT_MOUTH_SCALE = 1 / 2000
const BALLOON_CHAR_WIDTH_PX = 8
const BALLOON_TEXT_PADDING_X = 18
const MAX_TRANSCRIPT_LINES = 2

export function onRobotCreated(robot) {
  const chatConfig = {
    ...config.chat,
    instructions: 'あなたは丁寧なアシスタントロボットです。',
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
  let active = false
  let transcriptText = ''
  let transcriptLines = ['']
  let balloon = null
  let lastState = null
  let lastBalloonText = null

  const ensureBalloon = () => {
    if (balloon) return
    balloon = new SpeechBalloon({ name: 'chat-balloon', left: 0, right: 0, bottom: 4, font: 'k8x12-12' })
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

  const setBalloonText = (text) => {
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
      text: nextText,
      font: 'k8x12-12',
    })
    robot.renderer?.addDecorator(balloon)
  }

  const clearBalloon = () => {
    resetTranscript()
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
    setBalloonText('')
  }

  const removeBalloon = () => {
    if (balloon) robot.renderer?.removeDecorator(balloon)
    balloon = null
    resetTranscript()
    lastState = null
    lastBalloonText = null
  }

  const onTranscript = (text, more) => {
    const chunk = text ?? ''
    if (more && chunk.length === 0) {
      resetTranscript()
      setBalloonText('')
      return
    }
    appendTranscript(chunk)
    setBalloonText(transcriptText)
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
          robot.setMouthOpen(0)
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
        const mouthOpen = Math.min(Math.max(level * DEFAULT_MOUTH_SCALE, 0), 1)
        robot.setMouthOpen(mouthOpen)
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
    robot.application.setDrawerButtonState('toggleChat', true)
    chat.setVolume(0.5)
    ensureBalloon()
    clearBalloon()
    chat.start()
  }

  const stopChat = () => {
    if (!active) return
    active = false
    robot.application.setDrawerButtonState('toggleChat', false)
    chat.stop()
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
