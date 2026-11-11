import { createChatConversation, createXiaozhiV1Connection } from 'chat'
import type { ConversationEvent } from 'stackchan/voice/contracts'
import { createVoiceScope } from 'stackchan/voice/scope'
import { assert, equal } from 'testing/assert'
import FakeIO from 'testing/fakes/ChatAudioIO'
import { checkBorrowedAudio, checkSdkBootstrap, checkWorkerFlow } from 'testing/worker-flow'

async function run() {
  checkWorkerFlow()
  await checkBorrowedAudio()
  await checkSdkBootstrap()
  const scope = createVoiceScope()
  let closed = false,
    executions = 0
  class WorkerIO extends FakeIO {
    connect() {
      super.connect()
      FakeIO.lastOptions.onStateChanged(FakeIO.CONNECTED)
    }
    async drain() {}
    async fence() {
      return []
    }
    close() {
      closed = true
    }
  }
  const connection = createXiaozhiV1Connection({
    endpoint: 'wss://example.test/ws',
    deviceId: 'device-1',
    clientId: 'client-1',
    listeningMode: 'manual',
    helloExtension: { robot: true },
  })
  const conversation = createChatConversation({
    connection,
    chatAudioIOCtor: WorkerIO as never,
    tools: {
      definitions: [{ type: 'function', name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
      async execute(call) {
        executions++
        return { type: 'function_call_output', call_id: call.call_id, output: 'ok' }
      },
    },
  })
  const events: ConversationEvent[] = []
  const media = { input: {}, output: {}, media: {} } as never
  const session = await conversation.open({
    media,
    history: [],
    signal: scope.signal,
    onEvent(event) {
      events.push(event)
    },
  })
  const io = FakeIO.instances[0]
  equal(io.options.media, media, 'worker borrows the pipeline ports')
  equal(io.options.configuration.identity.deviceId, 'device-1')
  equal(io.options.configuration.features.mcp, true)
  equal(io.options.configuration.helloExtension.robot, true)
  equal(io.options.functions[0].name, 'echo')
  io.options.onPlayback({ outputId: 'failed-audio', state: 'failed', generation: 0, position: { basis: 'unknown' } })
  assert(
    events.some((event) => event.type === 'turn.ended' && event.turnId === 'failed-audio' && event.status === 'failed'),
    'speaker failure must not complete the chat turn',
  )
  equal(conversation.capabilities.textInput, false, 'XiaoZhi v1 supports speech input')
  let unsupported = false
  try {
    await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }, scope)
  } catch (error) {
    unsupported = error.code === 'unsupported_capability'
  }
  equal(unsupported, true)
  io.emitInputTranscript('hello', false)
  assert(
    events.some((event) => event.type === 'input.transcript' && event.value.final),
    'observed final transcript',
  )
  io.emitFunctionCall('call-1', 'echo', {})
  io.emitFunctionCall('call-1', 'echo', {})
  await Promise.resolve()
  equal(executions, 1, 'duplicate tool event executes once')
  equal(io.lastFunctionResult.call, 'call-1')
  equal((await session.interrupt()).history, 'restart-required')
  equal(closed, true, 'old worker no longer forwards media')
  equal((await session.close({ mode: 'abort' })).remoteFinalization, 'confirmed')
}
run().then(
  () => trace('@@STACKCHAN_TEST:PASS@@\n'),
  (error) => {
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    throw error
  },
)
