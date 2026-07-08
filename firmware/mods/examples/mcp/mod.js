import { EmotionNames, emotionFromName } from 'face-state'
import { MCPServerService } from 'mcp-server'

const EMOTION_NAMES = EmotionNames

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

  const _mcpServer = new MCPServerService({
    port: 8080,
    tools: mcpTools,
  })

  trace('MCP Server started on port 8080\n')
  trace('Available tools:\n')
  for (const tool of mcpTools) {
    trace(`  - ${tool.name}: ${tool.description}\n`)
  }
  trace('Connect with MCP client at http://[robot-ip]:8080/mcp\n')
}
