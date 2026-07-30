import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeXsbugLog, evaluateChatSmokeLog, selectChatSmokeProgress } from './chat-smoke-log.mjs'

test('decodes xsbug log frames and XML entities', () => {
  const raw =
    '<log path="main.js" line="1">[ChatSmoke] START&#10;</log>' +
    '<log>[OpenAIRealtime] a &amp; b &lt; c&#13;&#10;</log>'
  assert.equal(decodeXsbugLog(raw), '[ChatSmoke] START\n[OpenAIRealtime] a & b < c\r\n')
})

test('requires disconnect after a successful response', () => {
  const passing = [
    '[ChatSmoke] START timeoutMs=300000',
    '[ChatSmoke] PASS stage=response-complete',
    'onStateChanged: speaking',
  ].join('\n')
  assert.deepEqual(evaluateChatSmokeLog(passing), {
    status: 'passing',
    marker: '[ChatSmoke] PASS stage=response-complete',
    starts: 1,
  })

  const passed = `${passing}\nonStateChanged: disconnected\n`
  assert.deepEqual(evaluateChatSmokeLog(passed), {
    status: 'passed',
    marker: '[ChatSmoke] PASS stage=response-complete',
    starts: 1,
  })
})

test('reports explicit failures, runtime exceptions, and unexpected restarts', () => {
  assert.equal(evaluateChatSmokeLog('[ChatSmoke] START\n[ChatSmoke] FAIL reason=timeout\n').status, 'failed')
  assert.equal(evaluateChatSmokeLog('[ChatSmoke] START\n# Exception: RangeError\n').status, 'failed')
  assert.equal(
    evaluateChatSmokeLog('[ChatSmoke] START\n[DuplexChatAudioIO] input summary drops=1 postFailures=0\n').status,
    'failed',
  )
  assert.equal(
    evaluateChatSmokeLog(
      '[ChatSmoke] START\n[DuplexChatAudioIO] audio summary captured=100 inputOverruns=1 micOverruns=0 refOverruns=0\n',
    ).status,
    'failed',
  )
  assert.match(evaluateChatSmokeLog('[ChatSmoke] START\nboot\n[ChatSmoke] START\n').reason, /restarted unexpectedly/)
})

test('can require a bounded digital input probe to reach the transport', () => {
  const lifecycle = [
    '[ChatSmoke] START timeoutMs=300000',
    '[OpenAIRealtime] input pump started barrierLength=4 chunkBytes=2048',
    '[OpenAIRealtime] event=input_audio_buffer.speech_started elapsedMs=8000 audioStartMs=0',
    '[OpenAIRealtime] event=input_audio_buffer.speech_stopped elapsedMs=10000 audioEndMs=704',
    '[OpenAIRealtime] event=input_audio_buffer.committed elapsedMs=10010',
    '[OpenAIRealtime] event=response.created elapsedMs=10020',
    '[OpenAIRealtime] event=response.done elapsedMs=12000 status=completed',
    '[ChatSmoke] PASS stage=response-complete',
    '[DuplexChatAudioIO] input gate summary opens=1 closes=1 rejectedAttacks=0 maxLevel=2200 state=0',
    '[DuplexChatAudioIO] input probe summary signalSamples=24000 silenceSamples=13312 completed=true',
    '[OpenAIRealtime] input pump summary reason=disconnect runs=80 sends=9 bytes=111168 discardedBytes=0 maxSendBytes=2048',
    'onStateChanged: disconnected',
  ].join('\n')

  assert.equal(evaluateChatSmokeLog(lifecycle, { requireInput: true }).status, 'passed')
  assert.match(
    evaluateChatSmokeLog(lifecycle.replace('sends=9 bytes=111168', 'sends=0 bytes=0'), {
      requireInput: true,
    }).reason,
    /did not reach/,
  )
  assert.match(
    evaluateChatSmokeLog(lifecycle.replace('maxSendBytes=2048', 'maxSendBytes=4096'), {
      requireInput: true,
    }).reason,
    /exceeded its configured send chunk/,
  )
  assert.match(
    evaluateChatSmokeLog(lifecycle.replace('completed=true', 'completed=false'), {
      requireInput: true,
    }).reason,
    /did not complete/,
  )
  assert.match(
    evaluateChatSmokeLog(lifecycle.replace('status=completed', 'status=cancelled'), {
      requireInput: true,
    }).reason,
    /settled server VAD response/,
  )
  assert.match(
    evaluateChatSmokeLog(
      lifecycle.replace(
        'onStateChanged: disconnected',
        '[OpenAIRealtime] event=response.created elapsedMs=13000\nonStateChanged: disconnected',
      ),
      { requireInput: true },
    ).reason,
    /settled server VAD response/,
  )
})

test('selects only chat smoke progress lines', () => {
  assert.deepEqual(
    selectChatSmokeProgress(
      [
        'wifi connected',
        '[ChatSmoke] START timeoutMs=300000',
        '[OpenAIRealtime] event=response.created',
        '[DuplexChatAudioIO] input transport=shared-ring',
        'onStateChanged: speaking',
      ].join('\n'),
    ),
    [
      '[ChatSmoke] START timeoutMs=300000',
      '[OpenAIRealtime] event=response.created',
      '[DuplexChatAudioIO] input transport=shared-ring',
      'onStateChanged: speaking',
    ],
  )
})
