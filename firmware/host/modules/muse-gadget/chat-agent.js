function unsupported() {
  return Object.assign(new Error('Muse accepts the latest user text only'), { code: 'unsupported_capability' })
}

export function createMuseChatAgent(session) {
  return {
    capabilities: { image: false },
    async run({ input, turnId }, { signal }) {
      const message = input[input.length - 1]
      if (
        message?.type !== 'message' ||
        message.role !== 'user' ||
        !Array.isArray(message.content) ||
        !message.content.length ||
        message.content.some((item) => item.type !== 'input_text' || typeof item.text !== 'string')
      )
        throw unsupported()
      const result = await session.send({ message: message.content.map((item) => item.text).join('\n') }, { signal })
      const output = result.messages.map((message) => ({
        type: 'message',
        id: message.id,
        role: 'assistant',
        content: [{ type: 'output_text', text: message.text }],
      }))
      return { status: result.status, response: { id: turnId, status: result.status, output }, appended: output }
    },
  }
}
