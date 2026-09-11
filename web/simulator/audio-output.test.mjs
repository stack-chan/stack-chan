import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHostAudioOutBridge } from './audio-output.mjs'
import {
  MAX_PLAYBACK_BYTES,
  MAX_PLAYBACK_DURATION_MS,
  PLAYBACK_GRACE_MS,
  PLAYBACK_PREPARE_TIMEOUT_MS,
  PLAYBACK_RELEASE_TIMEOUT_MS,
} from '../../firmware/contracts/audio-playback.js'

const drain = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const audioBuffer = () => ({ duration: 0.1, length: 2400, numberOfChannels: 1, sampleRate: 24000 })
function rig(options = {}) {
  let now = 0,
    nextTimer = 0
  const timers = new Map(),
    contexts = []
  class Node {
    starts = 0
    stops = 0
    disconnects = 0
    frequency = { value: 0 }
    gain = { value: 0 }
    connect() {
      options.connect?.()
    }
    disconnect() {
      this.disconnects++
      options.disconnect?.()
    }
    start() {
      options.start?.()
      this.starts++
    }
    stop(when) {
      if (when === undefined) {
        this.stops++
        options.stop?.()
      }
    }
    end() {
      this.onended?.()
    }
  }
  class Context {
    sampleRate = options.sampleRate ?? 48000
    state = options.resume ? 'suspended' : 'running'
    currentTime = 1
    nodes = []
    gains = []
    closes = 0
    destination = {}
    resume() {
      return options.resume().then(() => {
        if (this.state !== 'closed') this.state = 'running'
      })
    }
    async decodeAudioData(buffer) {
      // Mirror Web Audio's transfer of the input buffer, not its audio decoder.
      const transferred = structuredClone(buffer, { transfer: [buffer] })
      return options.decode ? options.decode(transferred) : audioBuffer()
    }
    createOscillator() {
      const node = new Node()
      this.nodes.push(node)
      return node
    }
    createBufferSource() {
      return this.createOscillator()
    }
    createGain() {
      options.gain?.()
      const node = new Node()
      this.gains.push(node)
      return node
    }
    close() {
      this.closes++
      const released = options.close?.()
      return Promise.resolve(released).then(() => {
        this.state = 'closed'
      })
    }
  }
  const bridge = createHostAudioOutBridge({
    createAudioContext(settings) {
      options.construct?.(settings)
      const context = new Context()
      contexts.push(context)
      return context
    },
    setTimeoutFn(fn, delay) {
      options.setTimer?.()
      const id = ++nextTimer
      timers.set(id, { fn, at: now + delay })
      return id
    },
    clearTimeoutFn(id) {
      timers.delete(id)
      options.clearTimer?.()
    },
  })
  async function advance(ms) {
    const until = now + ms
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].fn()
      await drain()
    }
    now = until
    await drain()
  }
  return { bridge, contexts, timers, advance }
}

test('100 successful and cancelled playbacks release nodes, contexts, handles, and timers', async () => {
  const r = rig()
  for (let index = 0; index < 100; index++) {
    const tone = r.bridge.tone({ hz: 880, duration: 100, volume: 0.25 })
    await drain()
    const context = r.contexts.at(-1)
    assert.equal(context.nodes[0].frequency.value, 880)
    assert.equal(context.gains[0].gain.value, 0.25)
    context.nodes[0].end()
    await tone
    const id = r.bridge.startPlayBuffer(new ArrayBuffer(48))
    assert.ok(id > 0)
    await drain()
    r.bridge.stopPlay(id)
    await drain()
    assert.equal(r.bridge.playStatus(id), -1)
    assert.equal(r.bridge.playDetails(id).error.code, 'CANCELLED')
    assert.equal(r.bridge.playDetails(id).quiet, true)
    r.bridge.releasePlay(id)
    assert.equal(r.timers.size, 0)
  }
  assert.equal(r.contexts.length, 200)
  assert.ok(r.contexts.every((context) => context.state === 'closed' && context.closes === 1))
  assert.ok(r.contexts.every((context) => [...context.nodes, ...context.gains].every((node) => node.disconnects === 1)))
  await r.bridge.close()
})

test('completion and handoff wait for AudioContext.close, and retired handles cannot stop a successor', async () => {
  const close = deferred()
  const options = { close: () => close.promise }
  const r = rig(options)
  const id = r.bridge.startTone({ hz: 440, duration: 100 })
  await drain()
  const oldNode = r.contexts[0].nodes[0]
  const oldEnded = oldNode.onended
  oldNode.end()
  assert.equal(r.bridge.playStatus(id), 2)
  assert.equal(r.bridge.playDetails(id).quiet, false)
  const busy = r.bridge.startTone({ hz: 440, duration: 100 })
  assert.equal(r.bridge.playDetails(busy).error.code, 'BUSY')
  r.bridge.releasePlay(busy)
  close.resolve()
  await drain()
  assert.equal(r.bridge.playStatus(id), 1)
  r.bridge.releasePlay(id)
  options.close = undefined
  const next = r.bridge.startTone({ hz: 440, duration: 100 })
  await drain()
  r.bridge.stopPlay(id)
  oldEnded()
  assert.equal(r.contexts[1].closes, 0)
  r.bridge.stopPlay(next)
  await drain()
  r.bridge.releasePlay(next)
  await r.bridge.close()
})

test('tone requests a sample rate that can represent its frequency and verifies the actual context', async () => {
  const settings = []
  const r = rig({ sampleRate: 24000, construct: (value) => settings.push(value) })
  await assert.rejects(r.bridge.tone({ hz: 20000, duration: 10 }), { code: 'UNSUPPORTED' })
  assert.deepEqual(settings, [{ sampleRate: 48000 }])
  assert.equal(r.contexts[0].nodes.length, 0, 'unrepresentable tone never starts an oscillator')
  assert.equal(r.contexts[0].closes, 1)
  await assert.rejects(r.bridge.tone({ hz: 9, duration: 10 }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(r.bridge.tone({ hz: 20001, duration: 10 }), { code: 'INVALID_ARGUMENT' })
  assert.equal(r.contexts.length, 1, 'out-of-contract frequencies fail before acquisition')
  await r.bridge.close()
})

test('elapsed duration without onended is a timeout, never successful playback', async () => {
  const r = rig()
  const id = r.bridge.startTone({ hz: 440, duration: 100 })
  await drain()
  await r.advance(100 + PLAYBACK_GRACE_MS)
  assert.equal(r.bridge.playStatus(id), -1)
  assert.equal(r.bridge.playDetails(id).error.code, 'TIMEOUT')
  assert.equal(r.bridge.playDetails(id).quiet, true)
  assert.equal(r.contexts[0].closes, 1)
  r.bridge.releasePlay(id)
  await r.bridge.close()
})

test('decoding preserves borrowed bytes and cannot acquire a source after cancellation', async () => {
  const decode = deferred()
  const r = rig({ decode: () => decode.promise })
  const bytes = Uint8Array.of(1, 2, 3).buffer
  const id = r.bridge.startPlayBuffer(bytes)
  await drain()
  r.bridge.stopPlay(id)
  r.bridge.releasePlay(id)
  await drain()
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3])
  assert.equal(r.bridge.playDetails(id).quiet, false, 'decoding remains owned after context closure')
  decode.resolve(audioBuffer())
  await drain()
  assert.equal(r.contexts[0].nodes.length, 0)
  assert.equal(r.contexts[0].closes, 1)
  assert.equal(r.timers.size, 0)
  await r.bridge.close()
})

test('suspend waits for resume or decode continuations, and late completion permits a deliberate retry', async () => {
  for (const phase of ['resume', 'decode']) {
    const pending = deferred()
    const options = { [phase]: () => pending.promise }
    const r = rig(options)
    const id = r.bridge.startPlayBuffer(new ArrayBuffer(48))
    await drain()
    const stopping = r.bridge.suspend()
    const stopped = assert.rejects(stopping, { code: 'TIMEOUT' })
    await r.advance(PLAYBACK_RELEASE_TIMEOUT_MS)
    await stopped
    assert.equal(r.bridge.playDetails(id).quiet, false)
    assert.equal(r.bridge.playDetails(id).releaseError.code, 'TIMEOUT')
    assert.throws(() => r.bridge.resume(), { code: 'TIMEOUT' })
    pending.resolve(audioBuffer())
    await drain()
    assert.equal(r.contexts[0].nodes.length, 0)
    await r.bridge.suspend()
    r.bridge.resume()
    options[phase] = undefined
    const tone = r.bridge.tone({ hz: 440, duration: 1 })
    await drain()
    r.contexts.at(-1).nodes[0].end()
    await tone
    await r.bridge.close()
  }
})

test('preparation times out and owns the pending decoder until it returns', async () => {
  const decode = deferred()
  const r = rig({ decode: () => decode.promise })
  const id = r.bridge.startPlayBuffer(new ArrayBuffer(48))
  await drain()
  await r.advance(PLAYBACK_PREPARE_TIMEOUT_MS)
  assert.equal(r.contexts[0].closes, 1)
  decode.resolve(audioBuffer())
  await drain()
  assert.equal(r.bridge.playDetails(id).error.code, 'TIMEOUT')
  assert.equal(r.bridge.playDetails(id).quiet, true)
  r.bridge.releasePlay(id)
  await r.bridge.close()
})

test('construction, decoding, connection, gain, and start failures roll back acquired context and nodes', async () => {
  for (const phase of ['construct', 'decode', 'connect', 'gain', 'start']) {
    const r = rig({
      [phase]() {
        throw new Error(`${phase} failed`)
      },
    })
    await assert.rejects(r.bridge.play(new ArrayBuffer(48)), { code: 'IO' })
    assert.equal(r.contexts.length, phase === 'construct' ? 0 : 1)
    assert.ok(r.contexts.every((context) => context.closes === 1 && context.state === 'closed'))
    assert.ok(
      r.contexts.every((context) => [...context.nodes, ...context.gains].every((node) => node.disconnects === 1))
    )
    assert.equal(r.timers.size, 0)
    await r.bridge.close()
  }
})

test('release rejection or missing close confirmation faults output instead of handing it off', async () => {
  for (const close of [() => Promise.reject(new Error('release failed')), () => new Promise(() => {})]) {
    const r = rig({ close })
    const id = r.bridge.startTone({ hz: 440, duration: 1 })
    await drain()
    r.bridge.stopPlay(id)
    await r.advance(PLAYBACK_RELEASE_TIMEOUT_MS)
    assert.equal(r.bridge.playStatus(id), -1)
    assert.equal(r.bridge.playDetails(id).quiet, false)
    assert.ok(r.bridge.playDetails(id).releaseError)
    const successor = r.bridge.startTone({ hz: 440, duration: 1 })
    assert.equal(r.bridge.playStatus(successor), -1)
    assert.equal(r.contexts.length, 1)
    r.bridge.releasePlay(id)
    r.bridge.releasePlay(successor)
    await assert.rejects(r.bridge.close())
    assert.throws(() => r.bridge.resume(), { code: 'CLOSED' })
  }
})

test('invalid arguments, empty or excessive decoded audio, and exhausted handles do not start sound', async () => {
  const r = rig()
  for (const options of [
    { hz: NaN, duration: 10 },
    { hz: 440, duration: Infinity },
    { hz: 440, duration: 1, volume: NaN },
  ]) {
    await assert.rejects(r.bridge.tone(options), { code: 'INVALID_ARGUMENT' })
  }
  for (const bytes of [new ArrayBuffer(0), new ArrayBuffer(MAX_PLAYBACK_BYTES + 1)])
    await assert.rejects(r.bridge.play(bytes), { code: 'INVALID_ARGUMENT' })
  assert.equal(r.contexts.length, 0)
  const ids = Array.from({ length: 4 }, () => r.bridge.startTone({ hz: 440, duration: 10 }))
  assert.ok(ids.every((id) => id > 0))
  assert.equal(r.bridge.startTone({ hz: 440, duration: 1 }), 0)
  for (const id of ids) r.bridge.releasePlay(id)
  await drain()
  await r.bridge.close()
  for (const decoded of [
    { ...audioBuffer(), length: 0 },
    { ...audioBuffer(), duration: MAX_PLAYBACK_DURATION_MS / 1000 + 1 },
  ]) {
    const invalid = rig({ decode: () => decoded })
    await assert.rejects(invalid.bridge.play(new ArrayBuffer(48)), { code: 'IO' })
    assert.equal(invalid.contexts[0].nodes.length, 0)
    await invalid.bridge.close()
  }
})

test('stop, disconnect, and timer failures still close every acquired node and fault output', async () => {
  for (const phase of ['stop', 'disconnect', 'clearTimer', 'setTimer']) {
    const options = {}
    const r = rig(options)
    const id = r.bridge.startTone({ hz: 440, duration: 100 })
    await drain()
    options[phase] = () => {
      throw new Error(`${phase} failed`)
    }
    r.bridge.stopPlay(id)
    await drain()
    assert.equal(r.contexts[0].closes, 1)
    assert.equal(r.contexts[0].state, 'closed')
    assert.ok(r.contexts[0].nodes.every((node) => node.disconnects === 1))
    assert.ok(r.contexts[0].gains.every((node) => node.disconnects === 1))
    assert.equal(r.bridge.playDetails(id).releaseError.code, 'IO')
    assert.equal(r.bridge.playAvailable(), false)
    assert.equal(r.timers.size, 0)
    await assert.rejects(r.bridge.close(), { code: 'IO' })
  }
})

test('a resolved close without a closed context is not release acknowledgement', async () => {
  const r = rig()
  const id = r.bridge.startTone({ hz: 440, duration: 100 })
  await drain()
  r.contexts[0].close = async () => {}
  r.contexts[0].nodes[0].end()
  await drain()
  assert.equal(r.bridge.playStatus(id), -1)
  assert.equal(r.bridge.playDetails(id).quiet, false)
  assert.equal(r.bridge.playDetails(id).releaseError.code, 'IO')
  await assert.rejects(r.bridge.close(), { code: 'IO' })
})

test('browser exception codes are normalized to the public IO code', async () => {
  for (const error of [
    new DOMException('decode failed', 'NotSupportedError'),
    Object.assign(new Error('decode failed'), { code: 'E_DECODE' }),
  ]) {
    const r = rig({
      decode: async () => {
        throw error
      },
    })
    await assert.rejects(r.bridge.play(new ArrayBuffer(12)), { code: 'IO' })
    assert.equal(r.contexts[0].state, 'closed')
    await r.bridge.close()
  }
})

test('missing Web Audio fails explicitly and close is permanent', async () => {
  const bridge = createHostAudioOutBridge()
  assert.equal(bridge.playAvailable(), false)
  await assert.rejects(bridge.tone({ hz: 440, duration: 1 }), { code: 'UNSUPPORTED' })
  await bridge.close()
  await assert.rejects(bridge.play(new ArrayBuffer(48)), { code: 'CLOSED' })
})
