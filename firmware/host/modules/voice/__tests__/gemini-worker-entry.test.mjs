import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import * as bridge from '../gemini-worker-bridge.js'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'gemini-worker-events')
      return next(new URL('../gemini-worker-events.js', import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { failureCode, synthesize } = await import('../gemini-worker-request.js')

const source = (await readFile(new URL('../gemini-worker-entry.js', import.meta.url), 'utf8')).replace(
  /^import [^\r\n]+\r?\n/gm,
  '',
)
for (const nativeTransport of [false, true]) {
  for (const outcome of ['done', 'provider_failed', 'cancelled']) {
    for (const enabled of [false, true]) {
      test(`Worker ${outcome}, diagnostics ${enabled}, native ${nativeTransport}: cleanup precedes one terminal post`, async () => {
        const events = [],
          messages = []
        const self = {
          postMessage(message) {
            events.push('terminal')
            messages.push(message)
          },
        }
        const context = {
          self,
          ...bridge,
          Time: { ticks: 1 },
          findLF() {},
          createSlotWriter() {
            return {
              writeImmediate() {},
              async drain() {
                events.push('drain')
              },
              cancel() {
                events.push('slots-clean')
              },
            }
          },
          createVoiceScope() {
            return {
              signal: new AbortController().signal,
              abort() {},
              dispose() {
                events.push('scope-clean')
              },
            }
          },
          NativeReader: class {},
          Timer: {},
          createNativeSpeechTransport(endpoint, _apiKey, timeout, runtime) {
            assert.equal(nativeTransport, true)
            assert.equal(endpoint, 'https://fixture.invalid')
            assert.equal(timeout, 45000)
            assert.equal(typeof runtime.Reader, 'function')
            return {}
          },
          createResponseTransport(...args) {
            assert.equal(nativeTransport, false)
            args[6]?.([2, 0, 200])
            return {}
          },
          async synthesize(_request, job) {
            job.onMetrics({ pcmBytes: 5760 })
            if (outcome !== 'done') {
              job.onFailure(0)
              throw Object.assign(Error(), { code: outcome })
            }
          },
          failureCode: (error) => error.code,
        }
        vm.runInNewContext(source, context)
        self.onmessage({
          type: 'start',
          endpoint: 'https://fixture.invalid',
          reportTransport: enabled,
          nativeTransport,
        })
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(messages.length, 1)
        assert.deepEqual(events.slice(-3), ['slots-clean', 'scope-clean', 'terminal'])
        assert.equal(messages[0].type, outcome === 'done' ? 'done' : 'error')
        assert.equal(messages[0].code, outcome === 'done' ? undefined : outcome)
        assert.equal(
          messages[0].diagnostics.some((x) => x.type === 'transport'),
          enabled && !nativeTransport,
        )
        assert.equal(
          messages[0].diagnostics.some((x) => x.type === 'metrics'),
          true,
        )
      })
    }
  }
}

function runSpeechWorker(events, onPcm, { sampleRate = 24000, nativeTransport = true } = {}) {
  ArrayBuffer.fromString ??= (value) => new TextEncoder().encode(value).buffer
  String.fromArrayBuffer ??= (bytes, offset = 0, length = bytes.byteLength - offset) =>
    new TextDecoder().decode(new Uint8Array(bytes, offset, length))
  Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, 'base64'))
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const posted = [],
    acknowledged = [],
    terminal = []
  const worker = {
    postMessage(message) {
      if (message.type === 'ack') acknowledged.push(message.seq)
      queueMicrotask(() => self.onmessage(message))
    },
    terminate() {},
  }
  const self = {
    postMessage(message) {
      if (message.type === 'pcm') posted.push(message.length)
      else terminal.push(message.type)
      queueMicrotask(() => worker.onmessage(message))
    },
  }
  const request = async (_body, feed) => {
    for (const bytes of events) {
      const value = {
        event_type: 'step.delta',
        delta: {
          type: 'audio',
          data: Buffer.from(bytes).toString('base64'),
          mime_type: `audio/l16;rate=${sampleRate}`,
        },
      }
      const event = encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
      for (let offset = 0; offset < event.length; offset += 4096) await feed(event.subarray(offset, offset + 4096))
    }
    await feed(encoder.encode('data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n'))
  }
  vm.runInNewContext(source, {
    ...bridge,
    self,
    failureCode,
    synthesize,
    NativeReader: class {},
    Time: { ticks: 0 },
    Timer: {},
    findLF: (bytes, offset) => bytes.indexOf(10, offset),
    createVoiceScope() {
      const own = new AbortController()
      return { signal: own.signal, abort: () => own.abort(), dispose() {} }
    },
    createNativeSpeechTransport: () => request,
    createResponseTransport: () => request,
  })
  const result = bridge.runWorkerJob(
    { text: 'fixture', sampleRate, signal: controller.signal, onPcm },
    { endpoint: 'https://fixture.invalid', nativeTransport },
    { spawn: () => worker, schedule: setTimeout, clear: clearTimeout },
  )
  return { controller, result, posted, acknowledged, terminal }
}

test('native 24 kHz uses one PCM credit for a typical event and preserves odd-boundary samples', async () => {
  const waveform = Uint8Array.from({ length: 5760 }, (_, i) => i % 251)
  const fragments = [waveform, Uint8Array.of(17), Uint8Array.of(23, 31, 37)]
  for (const [sampleRate, nativeTransport] of [
    [24000, true],
    [16000, true],
    [24000, false],
  ]) {
    const received = []
    const trial = runSpeechWorker(fragments, (bytes) => received.push(bytes.slice()), { sampleRate, nativeTransport })
    await trial.result
    assert.deepEqual(Buffer.concat(received), Buffer.concat(fragments))
    const expected = sampleRate === 24000 && nativeTransport ? [5760, 2, 2] : [2048, 2048, 1664, 2, 2]
    assert.deepEqual(trial.posted, expected)
    assert.deepEqual(
      trial.acknowledged,
      expected.map((_, index) => index),
    )
    assert.deepEqual(trial.terminal, ['done'])
  }
})

test('larger credits keep borrowed PCM stable and unblock cancellation with four pending slots', async () => {
  const waveform = Array.from({ length: 5 }, (_, i) => new Uint8Array(5760).fill(i))
  let borrowed, release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const trial = runSpeechWorker(waveform, (bytes) => {
    borrowed = bytes
    return gate
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(trial.posted, [5760, 5760, 5760, 5760])
  assert.deepEqual(borrowed, waveform[0])
  trial.controller.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' }))
  await assert.rejects(trial.result, { code: 'cancelled' })
  release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(trial.posted, [5760, 5760, 5760, 5760])
  assert.deepEqual(trial.acknowledged, [])
  assert.deepEqual(trial.terminal, ['error'])
})
