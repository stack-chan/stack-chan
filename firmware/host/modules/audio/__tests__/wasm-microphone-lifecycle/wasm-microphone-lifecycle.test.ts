import { CancellationSource } from 'cancellation'
import Microphone from 'microphone'
import { MAX_RECORDING_BYTES } from 'stackchan-contracts/audio-recording'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import type { WasmAudioInputBridge } from 'wasm-audio-bridge-contract'

type RecordState = {
  status: number
  quiet: boolean
  buffer: ArrayBuffer
  error?: { code: 'CANCELLED' | 'IO' | 'TIMEOUT'; message: string }
}
class Bridge implements WasmAudioInputBridge {
  readonly timers = new Set<ReturnType<typeof Timer.set>>()
  readonly records = new Map<number, RecordState>()
  readonly stopped: number[] = []
  readonly released: number[] = []
  nextId = 0
  available = true
  holdStop = false
  failStart = false
  failStop = false
  failRelease = false
  failSet = false
  failClear = false
  maxTimerMs = Infinity
  recordAvailable = () => this.available
  startRecord = (_duration: number) => {
    if (this.failStart) throw new Error('bridge start failed')
    const id = ++this.nextId
    this.records.set(id, { status: 0, quiet: false, buffer: new Uint8Array([1, 2, 3]).buffer })
    return id
  }
  recordStatus = (id: number) => this.records.get(id)?.status ?? -1
  recordDetails = (id: number) => {
    const state = this.records.get(id)
    return {
      quiet: state?.quiet ?? true,
      mimeType: 'audio/webm;codecs=opus',
      filename: 'speak.webm',
      error: state?.error,
    }
  }
  recordBuffer = (id: number) => this.state(id).buffer
  state(id: number): RecordState {
    const state = this.records.get(id)
    if (!state) throw new Error('recording handle missing')
    return state
  }
  stopRecord = (id: number) => {
    this.stopped.push(id)
    if (this.failStop) throw new Error('bridge stop failed')
    if (!this.holdStop) this.complete(id, 'CANCELLED')
  }
  releaseRecord = (id: number) => {
    this.released.push(id)
    if (this.failRelease) throw new Error('bridge release failed')
    this.records.delete(id)
  }
  setTimer = (callback: () => void, delay = 0) => {
    if (this.failSet) throw new Error('timer setup failed')
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
    if (this.failClear) throw new Error('timer release failed')
  }
  complete(id: number, code?: 'CANCELLED' | 'IO' | 'TIMEOUT', quiet = true) {
    const state = this.state(id)
    state.status = code ? -1 : 1
    state.quiet = quiet
    state.error = code ? { code, message: code } : undefined
  }
}
const observe = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  )
async function rejected(promise: Promise<unknown>, code: string) {
  equal((await observe(promise))?.code, code, `recording rejects with ${code}`)
}
const pause = () => new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
async function stopError(microphone: Microphone, code: string) {
  let error: { code?: string } | undefined
  try {
    await microphone.stop()
  } catch (caught) {
    error = caught as { code?: string }
  }
  equal(error?.code, code, 'stop preserves the release failure')
}

async function run() {
  const missing = new Microphone()
  equal(missing.available, false, 'missing input is unavailable')
  await rejected(missing.record(), 'UNSUPPORTED')
  missing.close()

  const bridge = new Bridge()
  const mic = new Microphone({ bridge })
  for (const invalid of [0, -1, NaN, Infinity, 15_001]) await rejected(mic.record(invalid), 'INVALID_ARGUMENT')
  equal(bridge.nextId, 0, 'invalid durations acquire no browser handle')
  const alreadyCancelled = new CancellationSource()
  alreadyCancelled.cancel()
  await rejected(mic.record(10, { signal: alreadyCancelled.signal }), 'CANCELLED')
  equal(bridge.nextId, 0, 'cancelled operations acquire no handle')

  for (let cycle = 0; cycle < 100; cycle++) {
    const source = new CancellationSource()
    const recording = mic.record(10, { signal: source.signal })
    bridge.complete(bridge.nextId)
    const buffer = (await recording) as ArrayBuffer & { mimeType?: string; filename?: string }
    equal(buffer.byteLength, 3, 'recording owns complete bytes')
    equal(buffer.mimeType, 'audio/webm;codecs=opus', 'encoded MIME survives the bridge')
    equal(buffer.filename, 'speak.webm', 'encoded extension survives the bridge')
    equal(bridge.records.size, 0, 'success releases its handle')
    equal(bridge.timers.size, 0, 'success releases its timers')
    equal(source.size, 0, 'success removes its subscription')

    const cancelled = new CancellationSource()
    const pending = observe(mic.record(10, { signal: cancelled.signal }))
    cancelled.cancel()
    equal((await pending)?.code, 'CANCELLED', 'cancel settles after input release')
    equal(bridge.records.size, 0, 'cancel releases its handle')
    equal(bridge.timers.size, 0, 'cancel releases its timers')
    equal(cancelled.size, 0, 'cancel removes its subscription')
  }

  bridge.holdStop = true
  const pending = observe(mic.record(10))
  await pause()
  let stopped = false
  const stopping = Promise.resolve(mic.stop()).then(() => {
    stopped = true
  })
  await pause()
  equal(stopped, false, 'stop waits for browser acknowledgement')
  equal(mic.recording, true, 'stopping retains the microphone')
  await rejected(mic.record(10), 'BUSY')
  bridge.complete(bridge.nextId, 'CANCELLED')
  await stopping
  equal((await pending)?.code, 'CANCELLED', 'stopped recording rejects')
  equal(bridge.timers.size, 0, 'acknowledged stop clears timers')
  bridge.holdStop = false

  const next = mic.record(10)
  const nextId = bridge.nextId
  const other = new Microphone({ bridge })
  other.close()
  equal(bridge.stopped.includes(nextId), false, 'closing an idle microphone cannot stop another handle')
  bridge.complete(nextId)
  await next

  const closed = observe(mic.record(10))
  await mic.close()
  equal((await closed)?.code, 'CLOSED', 'close supplies its reason after browser release')
  mic.close()
  await rejected(mic.record(10), 'CLOSED')
  equal(bridge.timers.size, 0, 'double close leaves no timer')
  equal(new Set(bridge.released).size, bridge.released.length, 'every recording is released exactly once')

  for (const invalid of [new ArrayBuffer(0), new ArrayBuffer(MAX_RECORDING_BYTES + 1)]) {
    const bad = new Bridge()
    const microphone = new Microphone({ bridge: bad })
    const recording = microphone.record(10)
    bad.state(bad.nextId).buffer = invalid
    bad.complete(bad.nextId)
    await rejected(recording, 'IO')
    equal(microphone.available, true, 'invalid data does not fault an already released input')
    equal(bad.records.size, 0, 'invalid data releases its handle')
    microphone.close()
  }

  const timed = new Bridge()
  timed.maxTimerMs = 5
  const timedMic = new Microphone({ bridge: timed })
  await rejected(timedMic.record(10), 'TIMEOUT')
  equal(timed.stopped.length, 1, 'deadline requests browser stop')
  equal(timedMic.available, true, 'acknowledged deadline cancellation allows reuse')
  equal(timed.timers.size, 0, 'timeout releases timers')
  timedMic.close()

  for (const failure of ['failStop', 'failRelease', 'failSet', 'failClear'] as const) {
    const broken = new Bridge()
    const microphone = new Microphone({ bridge: broken })
    const recording = observe(microphone.record(10))
    await pause()
    broken[failure] = true
    await stopError(microphone, 'IO')
    equal((await recording)?.code, 'IO', 'release failure rejects recording')
    equal(microphone.available, false, 'release failure prevents input transfer')
    equal(broken.released.length, 1, 'handle release attempted despite another cleanup failure')
    equal(broken.timers.size, 0, 'other timers still released')
    await rejected(microphone.record(10), 'IO')
  }

  const silent = new Bridge()
  silent.holdStop = true
  silent.maxTimerMs = 5
  const silentMic = new Microphone({ bridge: silent })
  const unconfirmed = observe(silentMic.record(10))
  await stopError(silentMic, 'TIMEOUT')
  equal((await unconfirmed)?.code, 'TIMEOUT', 'missing acknowledgement is bounded')
  equal(silentMic.available, false, 'unconfirmed release blocks input reuse')
  equal(silent.timers.size, 0, 'missing acknowledgement leaves no polling timer')

  const uncertain = new Bridge()
  const uncertainMic = new Microphone({ bridge: uncertain })
  const unsafe = uncertainMic.record(10)
  uncertain.complete(uncertain.nextId, 'IO', false)
  await rejected(unsafe, 'IO')
  await stopError(uncertainMic, 'IO')
  assert(!uncertainMic.available, 'browser cleanup failure is retained')

  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error?.stack ?? error}\n`))
