import Speaker from 'speaker'
import { StackchanError } from 'stackchan/errors'
import { MAX_PLAYBACK_BYTES } from 'stackchan-contracts/audio-playback'
import { state as voiceState } from 'stackchan-voice-test-state'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import { playbackReleaseFailure } from 'tts-playback-session'
import { TTS } from 'tts-stackchan-voice'
import type { WasmAudioOutputBridge } from 'wasm-audio-bridge-contract'

type PlayState = ReturnType<WasmAudioOutputBridge['playDetails']> & { status: number }
class Bridge implements WasmAudioOutputBridge {
  readonly timers = new Set<ReturnType<typeof Timer.set>>()
  readonly plays = new Map<number, PlayState>()
  readonly stopped: number[] = []
  readonly released: number[] = []
  readonly tones: number[][] = []
  readonly buffers: ArrayBuffer[] = []
  nextId = 0
  available = true
  holdStop = false
  fail = ''
  maxTimerMs = Infinity
  playAvailable = () => this.available
  start() {
    if (this.fail === 'start') throw new Error('unknown browser start failure')
    if (this.fail === 'allocate') return 0
    const id = ++this.nextId
    this.plays.set(id, { status: 0, quiet: false })
    return id
  }
  startTone = (hz: number, duration: number, volume = 1) => {
    this.tones.push([hz, duration, volume])
    return this.start()
  }
  startPlayBuffer = (buffer: ArrayBuffer) => {
    this.buffers.push(buffer)
    return this.start()
  }
  playStatus = (id: number) => this.plays.get(id)?.status ?? -1
  playDetails = (id: number): ReturnType<WasmAudioOutputBridge['playDetails']> => this.plays.get(id) ?? { quiet: true }
  stopPlay = (id: number) => {
    this.stopped.push(id)
    if (this.fail === 'stop') throw new Error('browser stop failure')
    if (!this.holdStop && !this.playDetails(id).quiet) this.complete(id, 'CANCELLED')
  }
  releasePlay = (id: number) => {
    this.released.push(id)
    this.plays.delete(id)
    if (this.fail === 'release') throw new Error('browser release failure')
  }
  setTimer = (callback: () => void, delay = 0) => {
    if (this.fail === 'set') throw new Error('timer setup failure')
    const timer = Timer.set(
      () => {
        this.timers.delete(timer)
        callback()
      },
      Math.min(delay, this.maxTimerMs),
    )
    this.timers.add(timer)
    return timer
  }
  clearTimer = (timer: unknown) => {
    if (this.timers.delete(timer as ReturnType<typeof Timer.set>)) Timer.clear(timer as ReturnType<typeof Timer.set>)
    if (this.fail === 'clear') throw new Error('timer release failure')
  }
  complete(id: number, code?: 'CANCELLED' | 'IO' | 'TIMEOUT', quiet = true) {
    this.plays.set(id, { status: code ? -1 : 1, quiet, error: code ? { code, message: code } : undefined })
  }
}
const env = globalThis as typeof globalThis & { __stackchanWasmAudioBridge?: WasmAudioOutputBridge; Host?: unknown }
const observe = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  )
const pause = () => new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
async function rejected(promise: Promise<unknown>, code: string) {
  equal((await observe(promise))?.code, code, `playback rejects with ${code}`)
}

function cancel(owner: Speaker | TTS, reason?: StackchanError) {
  const stop = owner.cancelPlayback
  if (!stop) throw new Error('playback did not install cancellation')
  return stop.call(owner, reason)
}

async function run() {
  trace('wasm output: validation\n')
  const missing = new Speaker()
  env.Host = {
    AudioOut: {
      tone() {
        throw new Error('legacy fallback must not run')
      },
    },
  }
  equal(missing.available(), false)
  await rejected(missing.tone(440, 10), 'UNSUPPORTED')
  await rejected(missing.play(new ArrayBuffer(1)), 'UNSUPPORTED')
  await missing.close()
  delete env.Host

  const bridge = new Bridge()
  env.__stackchanWasmAudioBridge = bridge
  const speaker = new Speaker({ volume: 0.3 })
  equal(speaker.available(), true)
  for (const invalid of [-1, NaN, Infinity, 60001]) await rejected(speaker.tone(440, invalid), 'INVALID_ARGUMENT')
  await rejected(speaker.tone(NaN, 10), 'INVALID_ARGUMENT')
  await rejected(speaker.tone(440, 10, NaN), 'INVALID_ARGUMENT')
  await rejected(speaker.play(new ArrayBuffer(0)), 'INVALID_ARGUMENT')
  await rejected(speaker.play(new ArrayBuffer(MAX_PLAYBACK_BYTES + 1)), 'INVALID_ARGUMENT')
  equal(bridge.nextId, 0, 'invalid requests acquire no browser handles')

  trace('wasm output: repeated playback\n')
  for (let cycle = 0; cycle < 100; cycle++) {
    const tone = speaker.tone(880, 20)
    bridge.complete(bridge.nextId)
    await tone
    equal(bridge.tones[cycle][2], 0.3, 'configured volume reaches the bridge')
    equal(bridge.plays.size, 0, 'success releases its handle')
    equal(bridge.timers.size, 0, 'success releases its timers')
    const bytes = new ArrayBuffer(64)
    const pending = observe(speaker.play(bytes))
    equal(bridge.buffers[cycle], bytes, 'XS borrows the buffer without copying')
    await cancel(speaker, new StackchanError('CANCELLED', 'test cancellation'))
    equal((await pending)?.code, 'CANCELLED')
    equal(bridge.plays.size, 0, 'cancellation releases its handle')
    equal(bridge.timers.size, 0, 'cancellation releases its timers')
  }

  trace('wasm output: handoff\n')
  bridge.holdStop = true
  const pending = observe(speaker.tone(440, 0))
  const oldId = bridge.nextId
  await pause()
  equal(speaker.streaming, true, 'elapsed tone duration is not completion')
  let stopped = false
  const stopping = Promise.resolve(cancel(speaker)).then(() => {
    stopped = true
  })
  await pause()
  equal(stopped, false, 'cancellation waits for browser release')
  await rejected(speaker.tone(440, 10), 'BUSY')
  bridge.complete(oldId, 'CANCELLED')
  await stopping
  assert(await pending, 'cancelled tone cannot succeed')
  bridge.holdStop = false
  const next = speaker.play(new ArrayBuffer(8))
  const nextId = bridge.nextId
  await new Speaker().close()
  assert(!bridge.stopped.includes(nextId), 'closing an idle owner does not stop another playback')
  bridge.complete(nextId)
  equal(await next, true)
  await speaker.close()
  await speaker.close()
  await rejected(speaker.tone(440, 1), 'CLOSED')
  equal(bridge.timers.size, 0)
  equal(new Set(bridge.released).size, bridge.released.length, 'every handle is released once')

  trace('wasm output: injected failures\n')
  for (const phase of ['start', 'allocate', 'stop', 'release', 'set', 'clear']) {
    trace(`wasm output: ${phase}\n`)
    const faulty = new Bridge()
    env.__stackchanWasmAudioBridge = faulty
    const owner = new Speaker()
    faulty.fail = phase
    const playing = observe(owner.tone(440, 10))
    if (phase === 'stop' || phase === 'release' || phase === 'clear') await observe(Promise.resolve(cancel(owner)))
    assert(await playing, `${phase} failure cannot succeed`)
    equal(faulty.timers.size, 0, `${phase} releases all timers`)
    if (phase !== 'allocate') {
      assert(playbackReleaseFailure(owner), `${phase} preserves uncertain release`)
      await rejected(owner.tone(440, 1), 'IO')
    }
    await observe(Promise.resolve().then(() => owner.close()))
  }

  trace('wasm output: deadlines\n')
  for (const holdStop of [false, true]) {
    const silent = new Bridge()
    silent.maxTimerMs = 3
    silent.holdStop = holdStop
    env.__stackchanWasmAudioBridge = silent
    const owner = new Speaker()
    await rejected(owner.tone(440, 10), 'TIMEOUT')
    equal(silent.timers.size, 0, 'deadlines release every poll')
    equal(Boolean(playbackReleaseFailure(owner)), holdStop, 'only unconfirmed release faults the owner')
    await observe(Promise.resolve().then(() => owner.close()))
  }

  const unsafe = new Bridge()
  env.__stackchanWasmAudioBridge = unsafe
  const unsafeOwner = new Speaker()
  const unsafePlay = unsafeOwner.tone(440, 10)
  unsafe.complete(unsafe.nextId, 'IO', false)
  unsafe.playDetails(unsafe.nextId).releaseError = { code: 'IO', message: 'context close failed' }
  unsafe.holdStop = true
  await rejected(unsafePlay, 'IO')
  assert(playbackReleaseFailure(unsafeOwner), 'browser release failure faults the XS owner')

  trace('wasm output: synthesis\n')
  const speechBridge = new Bridge()
  env.__stackchanWasmAudioBridge = speechBridge
  const voice = new TTS()
  const cancelledRender = new Promise<unknown>((resolve) => voice.stream('cancel before rendering', undefined, resolve))
  await cancel(voice, new StackchanError('CANCELLED', 'cancel renderer'))
  equal(((await cancelledRender) as { code: string }).code, 'CANCELLED')
  equal(voiceState.says.length, 0, 'cancel before the first tick never starts the voice')
  equal(speechBridge.timers.size, 0, 'render cancellation releases its scheduled tick')
  equal(speechBridge.buffers.length, 0, 'cancelled synthesis never starts browser playback')
  const spoken = new Promise<unknown>((resolve) => voice.stream('こんにちは', undefined, resolve))
  while (!speechBridge.nextId) await pause()
  assert(speechBridge.buffers[0].byteLength > 44, 'real WAV renderer forwards nonempty PCM')
  speechBridge.complete(speechBridge.nextId)
  equal(await spoken, undefined)
  await voice.close()
  equal(speechBridge.timers.size, 0)
  delete env.__stackchanWasmAudioBridge
  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error?.stack ?? error}\n`))
