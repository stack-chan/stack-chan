import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ChatService, type ChatCallbacks, type ConversationBackend } from '../../stackchan/services/chat.js'

class FakeChatAudioIO {
  static FAILED = 0
  static DISCONNECTED = 1
  static DISCONNECTING = 2
  static CONNECTING = 3
  static CONNECTED = 4
  static SPEAKING = 5
  static LISTENING = 6
  static WAITING = 7

  static instances: FakeChatAudioIO[] = []

  error = ''
  readonly options: Record<string, unknown>
  readonly calls: Array<[string, unknown[]]> = []

  constructor(options: Record<string, unknown>) {
    this.options = options
    FakeChatAudioIO.instances.push(this)
  }

  connect(): void {
    this.calls.push(['connect', []])
  }

  disconnect(): void {
    this.calls.push(['disconnect', []])
  }

  close(): void {
    this.calls.push(['close', []])
  }

  sendText(text: string): void {
    this.calls.push(['sendText', [text]])
  }

  sendFunctionResult(call: string, name: string, result: unknown): void {
    this.calls.push(['sendFunctionResult', [call, name, result]])
  }

  changeMicrophone(enabled: boolean): void {
    this.calls.push(['changeMicrophone', [enabled]])
  }

  changeVolume(volume: number): void {
    this.calls.push(['changeVolume', [volume]])
  }
}

test('ChatService exposes the shared ConversationBackend contract', () => {
  const service: ConversationBackend = new ChatService({
    config: { type: 'openAIRealtime' },
    chatAudioIOCtor: FakeChatAudioIO,
  })

  service.start()
  service.stop()
  service.sendText('こんにちは')
  service.sendFunctionResult?.('call-1', 'set_emotion', { ok: true })
  service.setMicrophoneEnabled?.(false)
  service.setVolume?.(0.4)
  service.close()

  assert.equal(service.state, 'DISCONNECTED')
  assert.equal(service.error, '')
})

test('ChatService converts Dialogue-compatible tool schemas into ChatAudioIO functions', () => {
  FakeChatAudioIO.instances = []

  new ChatService({
    config: { type: 'openAIRealtime', instructions: 'short answers' },
    tools: {
      emotion: {
        name: 'set_emotion',
        description: 'Set emotion',
        inputSchema: {
          type: 'object',
          properties: {
            emotion: { type: 'string', description: 'emotion name' },
          },
          required: ['emotion'],
        },
      },
    },
    chatAudioIOCtor: FakeChatAudioIO,
  })

  const fake = FakeChatAudioIO.instances.at(-1)
  assert.ok(fake)

  assert.deepEqual(fake.options.functions, [
    {
      name: 'set_emotion',
      description: 'Set emotion',
      parameters: {
        type: 'object',
        properties: {
          emotion: { type: 'string', description: 'emotion name' },
        },
        required: ['emotion'],
      },
    },
  ])
})

test('ChatCallbacks keep transcript and level events backend-agnostic', () => {
  FakeChatAudioIO.instances = []

  const events: unknown[] = []
  const callbacks: ChatCallbacks = {
    onStateChanged: (state, error) => events.push(['state', state, error]),
    onInputLevelChanged: (level) => events.push(['input-level', level]),
    onOutputLevelChanged: (level) => events.push(['output-level', level]),
    onInputTranscript: (text, more) => events.push(['input-transcript', text, more]),
    onOutputTranscript: (text, more) => events.push(['output-transcript', text, more]),
    onFunctionCall: (call, name, params) => events.push(['function-call', call, name, params]),
  }

  new ChatService({
    config: { type: 'openAIRealtime' },
    callbacks,
    chatAudioIOCtor: FakeChatAudioIO,
  })
  const fake = FakeChatAudioIO.instances.at(-1)
  assert.ok(fake)

  ;(fake.options.onInputLevelChanged as (level: number) => void)(12)
  ;(fake.options.onOutputLevelChanged as (level: number) => void)(34)
  ;(fake.options.onInputTranscript as (text: string, more: boolean) => void)('user', false)
  ;(fake.options.onOutputTranscript as (text: string, more: boolean) => void)('assistant', true)
  ;(fake.options.onFunctionCall as (call: string, name: string, params: Record<string, unknown>) => void)(
    'call-1',
    'set_emotion',
    { emotion: 'HAPPY' },
  )
  ;(fake.options.onStateChanged as (state: number) => void)(FakeChatAudioIO.CONNECTED)

  assert.deepEqual(events, [
    ['input-level', 12],
    ['output-level', 34],
    ['input-transcript', 'user', false],
    ['output-transcript', 'assistant', true],
    ['function-call', 'call-1', 'set_emotion', { emotion: 'HAPPY' }],
    ['state', 'CONNECTED', undefined],
  ])
})
