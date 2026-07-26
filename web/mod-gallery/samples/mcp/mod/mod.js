import { EmotionNames, emotionFromName } from 'face-state'
import { MCPServerService } from 'mcp-server'
import Net from 'net'

const EMOTION_NAMES = EmotionNames
const MCP_PORT = 8080
const DRAWER_KEY = 'mcp-server:endpoint'

async function endpointMessage(context, server) {
  if (server.status === 'failed') {
    return `MCP server error:\n${server.error ?? 'failed to start'}`
  }

  const network = context.connectivity.network
  if (!network) {
    return 'MCP server unavailable:\nnetwork is not supported'
  }

  const ready = await network.ready
  if (ready.status !== 'connected') {
    return `MCP server unavailable:\n${ready.reason}`
  }

  try {
    const address = Net.get('IP')
    if (!address) {
      return 'MCP server unavailable:\nIP address is not available'
    }
    return `MCP server:\nhttp://${address}:${MCP_PORT}/mcp`
  } catch (error) {
    return `MCP server unavailable:\n${String(error)}`
  }
}

export function onContextCreated(robot) {
  trace('Starting MCP Server mod\n')

  const mcpTools = [
    {
      name: 'set_emotion',
      description: 'Change robot facial expression/emotion',
      parameters: [
        {
          name: 'emotion',
          type: 'string',
          description: `Robot emotion. Available options: ${EMOTION_NAMES.join(', ')}`,
          required: true,
        },
      ],
      handler: (args) => {
        const emotion = args.emotion

        if (!emotion || typeof emotion !== 'string') {
          return 'Error: Emotion is required and must be a string'
        }

        const upperEmotion = emotion.toUpperCase()
        const nextEmotion = emotionFromName(upperEmotion)
        if (nextEmotion === undefined) {
          return `Error: Invalid emotion. Available options: ${EMOTION_NAMES.join(', ')}`
        }

        try {
          robot.face.setEmotion(nextEmotion)
          return `Robot emotion changed to: ${upperEmotion}`
        } catch (error) {
          return `Error setting emotion: ${error}`
        }
      },
    },
    {
      name: 'say_message',
      description: 'Make robot speak a message',
      parameters: [
        {
          name: 'message',
          type: 'string',
          description: 'Text message for the robot to speak',
          required: true,
        },
      ],
      handler: async (args) => {
        const message = args.message

        if (!message || typeof message !== 'string') {
          return 'Error: Message is required and must be a string'
        }

        try {
          const result = await robot.audio.say(message)
          if (result.success) {
            return `Robot said: "${result.value}"`
          }
          return `Error speaking message: ${result.reason}`
        } catch (error) {
          return `Error speaking message: ${error}`
        }
      },
    },
  ]

  const mcpServer = new MCPServerService({
    port: MCP_PORT,
    tools: mcpTools,
  })

  let endpointVisible = false
  robot.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: 'MCP Server',
    kind: 'toggle',
    initialState: false,
    callback: async (context) => {
      endpointVisible = !endpointVisible
      context.drawer.setDrawerButtonState(DRAWER_KEY, endpointVisible)
      if (!endpointVisible) {
        context.hideBalloon()
        return
      }

      const message = await endpointMessage(context, mcpServer)
      if (endpointVisible) context.showBalloon(message)
    },
  })

  trace(`MCP Server started on port ${MCP_PORT}\n`)
  trace('Available tools:\n')
  for (const tool of mcpTools) {
    trace(`  - ${tool.name}: ${tool.description}\n`)
  }
  trace(`Connect with MCP client at http://[robot-ip]:${MCP_PORT}/mcp\n`)
}
