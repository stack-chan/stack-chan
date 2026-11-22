import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConversationPipeline, TurnResult } from 'stackchan/voice'
import { runTextConversation } from './workflow.js'

function fixture() {
  const calls: string[] = []
  const pending: ((result: TurnResult) => void)[] = []
  let closed = false
  const pipeline: ConversationPipeline = {
    capabilities: {
      textInput: true,
      imageInput: false,
      inputRoles: ['user'],
      interruption: 'remote-cancel',
      interruptionReuse: 'reusable',
      historyRepair: 'truncate',
      turnControl: 'client',
      submitCompletion: 'playback',
    },
    async start() {
      calls.push('start')
    },
    async setMicrophoneMuted(value) {
      calls.push(`muted:${value}`)
    },
    setVolume() {},
    async submit(message) {
      calls.push(message.content[0].type === 'input_text' ? message.content[0].text : 'image')
      return {
        completion: 'playback',
        id: String(pending.length + 1),
        done: new Promise<TurnResult>((resolve) => pending.push(resolve)),
      }
    },
    async interrupt() {
      return { playback: [], remote: 'cancelled', history: 'aligned' }
    },
    async close(options) {
      if (!closed) calls.push(`close:${options?.mode ?? 'abort'}`)
      closed = true
      return { reason: 'drained', remoteFinalization: 'not-required' }
    },
  }
  return { pipeline, pending, calls }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('minimal example waits for each response playback before sending or closing', async () => {
  const { pipeline, pending, calls } = fixture()
  const running = runTextConversation(pipeline, ['first', 'second'])
  await tick()
  assert.deepEqual(calls, ['muted:true', 'start', 'first'])
  pending[0]({ turnId: '1', status: 'completed' })
  await tick()
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'second'])
  pending[1]({ turnId: '2', status: 'completed' })
  await running
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'second', 'close:drain'])
})

test('minimal example aborts after a failed turn and does not send the next prompt', async () => {
  const { pipeline, pending, calls } = fixture()
  const running = runTextConversation(pipeline, ['first', 'second'])
  const rejected = assert.rejects(running, /Turn 1: failed/)
  await tick()
  pending[0]({ turnId: '1', status: 'failed' })
  await rejected
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'close:abort'])
})

test('minimal example closes even when startup fails', async () => {
  const { pipeline, calls } = fixture()
  pipeline.start = async () => {
    throw new Error('unavailable')
  }
  await assert.rejects(runTextConversation(pipeline, ['first']), /unavailable/)
  assert.deepEqual(calls, ['muted:true', 'close:abort'])
})
