import config from 'mc/config'
import { ChatService } from 'chat'
import { SpeechBalloon } from 'effects/speech-balloon'
import { Emotion } from 'face-context'

const DEFAULT_MOUTH_SCALE = 1 / 2000

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
  let userText = ''
  let agentText = ''
  let userBalloon = null
  let agentBalloon = null

  const updateBalloon = (type, text) => {
    const isUser = type === 'user'
    const current = isUser ? userBalloon : agentBalloon
    if (current) {
      robot.renderer?.removeDecorator(current)
      if (isUser) userBalloon = null
      else agentBalloon = null
    }
    if (!text) return
    const balloon = new SpeechBalloon(
      isUser
        ? { name: 'chat-user', right: 8, bottom: 8, width: 120, text }
        : { name: 'chat-agent', left: 8, top: 8, width: 120, text },
    )
    robot.renderer?.addDecorator(balloon)
    if (isUser) userBalloon = balloon
    else agentBalloon = balloon
  }

  const clearBalloons = () => {
    if (userBalloon) robot.renderer?.removeDecorator(userBalloon)
    if (agentBalloon) robot.renderer?.removeDecorator(agentBalloon)
    userBalloon = null
    agentBalloon = null
    userText = ''
    agentText = ''
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
        if (state === 'DISCONNECTED' || state === 'FAILED') {
          active = false
          robot.application.setDrawerButtonState('toggleChat', false)
          clearBalloons()
        }
      },
      onInputLevelChanged: (level) => {
        app?.distribute?.('onChatInputLevel', level)
      },
      onOutputLevelChanged: (level) => {
        const mouthOpen = Math.min(Math.max(level * DEFAULT_MOUTH_SCALE, 0), 1)
        robot.setMouthOpen(mouthOpen)
      },
      /*
      onInputTranscript: (text, more) => {
        if (more && text.length === 0) {
          userText = ''
          updateBalloon('user', '')
          return
        }
        userText += text
        const display = more ? `${userText}...` : userText
        updateBalloon('user', display)
      },
      onOutputTranscript: (text, more) => {
        if (more && text.length === 0) {
          agentText = ''
          updateBalloon('agent', '')
          return
        }
        agentText += text
        const display = more ? `${agentText}...` : agentText
        updateBalloon('agent', display)
      },
      */
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
    chat.start()
  }

  const stopChat = () => {
    if (!active) return
    active = false
    robot.application.setDrawerButtonState('toggleChat', false)
    chat.stop()
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
