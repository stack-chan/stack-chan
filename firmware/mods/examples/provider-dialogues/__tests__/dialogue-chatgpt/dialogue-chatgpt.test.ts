import { createAgent, createToolSet, createVision, type LLM, outputText } from 'stackchan/ai'
import { createVoiceScope } from 'stackchan/voice/scope'
import { createResponsesLLM } from 'stackchan-ai-responses'

const llm: LLM = {
  capabilities: { tools: true, image: false },
  async createResponse(request) {
    const hasResult = request.input.some(
      (item) => item.type === 'function_call_output' && item.call_id === 'call' && item.output === 'noon',
    )
    return {
      id: 'r',
      status: 'completed',
      output: hasResult
        ? [{ type: 'message', id: 'm', role: 'assistant', content: [{ type: 'output_text', text: '正午です' }] }]
        : [{ type: 'function_call', id: 'f', call_id: 'call', name: 'clock', arguments: '{}' }],
    }
  },
}
const agent = createAgent({
  llm,
  tools: createToolSet([
    {
      definition: {
        type: 'function',
        name: 'clock',
        description: 'Get local time',
        parameters: { type: 'object', properties: {} },
      },
      execute() {
        return 'noon'
      },
    },
  ]),
  instructions: '',
  maxToolRounds: 1,
})
agent
  .run(
    {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '何時？' }] }],
      sessionId: 'test',
      turnId: 'one',
    },
    createVoiceScope(),
  )
  .then(async (result) => {
    if (result.status !== 'completed' || outputText(result.response) !== '正午です') throw Error('tool loop failed')
    let released = false
    const vision = createVision({
      camera: {
        async capture() {
          return {
            image: { format: 'rgb565le', width: 1, height: 1, data: Uint8Array.of(0, 248) },
            capturedAtMs: 123,
            release() {
              released = true
            },
          }
        },
      },
      llm: createResponsesLLM({
        model: 'test',
        provider: 'test',
        async send(body, consume) {
          const data = new Uint8Array(body.length)
          let offset = 0
          for (const chunk of body.read()) {
            data.set(chunk, offset)
            offset += chunk.byteLength
          }
          const request = JSON.parse(String.fromArrayBuffer(data.buffer))
          if (
            offset !== body.length ||
            !request.input[0].content[1].image_url.startsWith('data:image/png;base64,iVBOR')
          )
            throw Error('invalid uploaded PNG')
          const completed = {
            type: 'response.completed',
            response: {
              id: 'r',
              status: 'completed',
              output: [{ type: 'message', id: 'm', role: 'assistant', content: [{ type: 'output_text', text: '赤' }] }],
            },
          }
          await consume(new Uint8Array(ArrayBuffer.fromString('data: ' + JSON.stringify(completed) + '\n\n')))
        },
      }),
    })
    const seen = await vision.observe({ question: '何色？' }, createVoiceScope())
    if (!released || seen.text !== '赤' || seen.capturedAtMs !== 123) throw Error('observation failed')
    trace('@@STACKCHAN_TEST:PASS@@\n')
  })
  .catch((error) => {
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    trace(String(error))
  })
