import {
  DEFAULT_PLAYBACK_VOLUME,
  MAX_PLAYBACK_BYTES,
  MAX_PLAYBACK_DURATION_MS,
  MAX_TONE_DURATION_MS,
  PLAYBACK_PREPARE_TIMEOUT_MS,
  PLAYBACK_GRACE_MS,
  PLAYBACK_RELEASE_TIMEOUT_MS,
  MIN_TONE_HZ,
  MAX_TONE_HZ,
  TONE_SAMPLE_RATE,
} from '../../firmware/contracts/audio-playback.js'

class AudioOutputError extends Error {
  constructor(code, message, cause) {
    super(message, { cause })
    this.code = code
  }
}
const failure = (code, message, cause) => new AudioOutputError(code, message, cause)
const ioFailure = (error) =>
  error instanceof AudioOutputError ? error : failure('IO', error?.message ?? String(error), error)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  promise.catch(() => {})
  return { promise, resolve, reject }
}
function defaultAudioContextFactory(options) {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContext) throw failure('UNSUPPORTED', 'Browser audio output is unavailable')
  return new AudioContext(options)
}
function finite(value, name, min, max) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw failure('INVALID_ARGUMENT', `${name} must be between ${min} and ${max}`)
}

/** One output owner across firmware VMs, with individually releasable handles. */
export function createHostAudioOutBridge({
  createAudioContext = defaultAudioContextFactory,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const operations = new Map()
  let nextId = 0
  let active, fault, closing, suspending
  let closed = false,
    suspended = false

  function clearTimers(op) {
    const timers = [...op.timers]
    op.timers.clear()
    for (const timer of timers) {
      try {
        clearTimeoutFn(timer)
      } catch (error) {
        op.cleanupFailure ??= ioFailure(error)
      }
    }
  }
  function after(op, ms, callback) {
    const timer = setTimeoutFn(() => {
      op.timers.delete(timer)
      if (!op.settled) callback()
    }, ms)
    op.timers.add(timer)
  }
  function settle(op, error) {
    if (op.settled) return
    clearTimers(op)
    op.error = op.cleanupFailure ?? error
    op.settled = true
    op.status = op.error ? -1 : 1
    if (op.error) op.result.reject(op.error)
    else op.result.resolve(true)
  }
  function releaseFailed(op, error) {
    op.cleanupFailure ??= ioFailure(error)
    fault ??= op.cleanupFailure
    op.releaseError ??= op.cleanupFailure
    op.quiescence.reject(op.cleanupFailure)
    settle(op, op.cleanupFailure)
  }
  function finishIfQuiet(op) {
    if (!op.stopping || op.preparing || op.contextClosing || (op.context && !op.contextClosed)) return
    clearTimers(op)
    if (op.cleanupFailure) {
      releaseFailed(op, op.cleanupFailure)
      return
    }
    op.context = undefined
    op.quiet = true
    if (active === op) active = undefined
    op.quiescence.resolve()
    settle(op, op.error)
    if (op.released) operations.delete(op.id)
  }
  function releaseResources(op) {
    const source = op.source
    op.source = undefined
    if (source) {
      try {
        source.onended = null
      } catch (error) {
        op.cleanupFailure ??= ioFailure(error)
      }
      if (op.started && !op.ended) {
        try {
          source.stop()
        } catch (error) {
          op.cleanupFailure ??= ioFailure(error)
        }
      }
      try {
        source.disconnect()
      } catch (error) {
        op.cleanupFailure ??= ioFailure(error)
      }
    }
    const gain = op.gain
    op.gain = undefined
    if (gain) {
      try {
        gain.disconnect()
      } catch (error) {
        op.cleanupFailure ??= ioFailure(error)
      }
    }
    if (op.context && !op.contextCloseStarted) {
      op.contextCloseStarted = op.contextClosing = true
      try {
        Promise.resolve(op.context.close()).then(
          () => {
            op.contextClosing = false
            if (op.context.state !== 'closed') return releaseFailed(op, failure('IO', 'AudioContext did not close'))
            op.contextClosed = true
            finishIfQuiet(op)
          },
          (error) => {
            op.contextClosing = false
            // A rejected close does not confirm that the output is quiet.
            releaseFailed(op, error)
          }
        )
      } catch (error) {
        op.contextClosing = false
        releaseFailed(op, error)
      }
    }
  }
  function requestStop(op, error) {
    if (!op || op.quiet) return
    if (error) op.error ??= error
    if (!op.stopping) {
      op.stopping = true
      op.status = 2
      clearTimers(op)
      try {
        after(op, PLAYBACK_RELEASE_TIMEOUT_MS, () => {
          op.releaseError ??= failure('TIMEOUT', 'Audio output release could not be confirmed')
          fault ??= op.releaseError
          op.quiescence.reject(op.releaseError)
          settle(op, op.releaseError)
        })
      } catch (caught) {
        releaseFailed(op, caught)
      }
    }
    releaseResources(op)
    finishIfQuiet(op)
  }
  async function prepare(op, kind, data, volume) {
    try {
      if (op.stopping) return
      const context = (op.context = createAudioContext(kind === 'tone' ? { sampleRate: TONE_SAMPLE_RATE } : undefined))
      if (op.stopping) return
      if (context.state === 'suspended') await context.resume()
      if (op.stopping) return
      if (context.state !== 'running') throw failure('IO', 'AudioContext is not running')
      let audioBuffer
      let durationMs = data.duration
      if (kind === 'buffer') {
        if (typeof context.decodeAudioData !== 'function') throw failure('UNSUPPORTED', 'Audio decoding is unavailable')
        // decodeAudioData detaches its input. Preserve the caller's borrowed buffer.
        audioBuffer = await context.decodeAudioData(data.slice(0))
        if (op.stopping) return
        durationMs = audioBuffer.duration * 1000
        if (
          !Number.isFinite(durationMs) ||
          durationMs <= 0 ||
          durationMs > MAX_PLAYBACK_DURATION_MS ||
          !Number.isSafeInteger(audioBuffer.length) ||
          audioBuffer.length <= 0 ||
          !Number.isInteger(audioBuffer.numberOfChannels) ||
          audioBuffer.numberOfChannels < 1 ||
          audioBuffer.numberOfChannels > 2
        )
          throw failure('IO', 'Decoded audio is empty or exceeds playback limits')
        op.source = context.createBufferSource()
        op.source.buffer = audioBuffer
      } else {
        if (!Number.isFinite(context.sampleRate) || data.hz >= context.sampleRate / 2)
          throw failure('UNSUPPORTED', 'AudioContext sample rate cannot represent this tone')
        op.source = context.createOscillator()
        op.source.frequency.value = data.hz
      }
      op.gain = context.createGain()
      op.gain.gain.value = volume
      op.source.connect(op.gain)
      op.gain.connect(context.destination)
      op.source.onended = () => {
        if (op.stopping) return
        op.ended = true
        requestStop(op)
      }
      if (op.stopping) return
      clearTimers(op)
      if (op.cleanupFailure) throw op.cleanupFailure
      after(op, durationMs + PLAYBACK_GRACE_MS, () =>
        requestStop(op, failure('TIMEOUT', 'Audio playback did not finish'))
      )
      op.source.start(context.currentTime)
      op.started = true
      if (kind === 'tone' && !op.stopping) op.source.stop(context.currentTime + durationMs / 1000)
    } catch (error) {
      requestStop(op, ioFailure(error))
    } finally {
      op.preparing = false
      if (op.stopping) releaseResources(op)
      finishIfQuiet(op)
    }
  }
  function start(kind, data, volume) {
    // A retiring VM must not retain new handles after suspend's snapshot.
    if (suspended || operations.size >= 4) return 0
    do {
      nextId = (nextId % 0x7fffffff) + 1
    } while (operations.has(nextId))
    const op = { id: nextId, status: 0, timers: new Set(), result: deferred(), quiescence: deferred(), quiet: false }
    operations.set(op.id, op)
    try {
      if (closed) throw failure('CLOSED', 'Audio output bridge is closed')
      if (fault) throw fault
      if (suspended || active) throw failure('BUSY', 'Audio output is already in use')
      finite(volume, 'volume', 0, 1)
      if (kind === 'tone') {
        finite(data.hz, 'frequency', MIN_TONE_HZ, MAX_TONE_HZ)
        finite(data.duration, 'durationMs', 0, MAX_TONE_DURATION_MS)
      } else if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > MAX_PLAYBACK_BYTES)
        throw failure('INVALID_ARGUMENT', 'Audio buffer is empty or exceeds playback limits')
      active = op
      after(op, PLAYBACK_PREPARE_TIMEOUT_MS, () => requestStop(op, failure('TIMEOUT', 'Audio preparation timed out')))
      op.preparing = true
      void Promise.resolve().then(() => prepare(op, kind, data, volume))
    } catch (error) {
      requestStop(op, ioFailure(error))
    }
    return op.id
  }
  function releasePlay(id) {
    const op = operations.get(id)
    if (!op) return
    op.released = true
    if (op.quiet) operations.delete(id)
    else requestStop(op, failure('CANCELLED', 'Playback released'))
  }
  async function suspend() {
    suspended = true
    if (suspending) return suspending
    suspending = (async () => {
      const owned = [...operations.values()]
      for (const op of owned) requestStop(op, failure('CANCELLED', 'Firmware audio output stopped'))
      const results = await Promise.allSettled(owned.filter((op) => !op.quiet).map((op) => op.quiescence.promise))
      for (const op of owned) releasePlay(op.id)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
      fault = undefined
    })()
    try {
      await suspending
    } finally {
      suspending = undefined
    }
  }
  async function result(id) {
    if (!id)
      throw failure(
        closed ? 'CLOSED' : 'BUSY',
        closed ? 'Audio output bridge is closed' : 'Audio output cannot accept a playback'
      )
    try {
      return await operations.get(id).result.promise
    } finally {
      releasePlay(id)
    }
  }
  const bridge = {
    playAvailable() {
      return (
        !closed &&
        !fault &&
        (createAudioContext !== defaultAudioContextFactory ||
          typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === 'function')
      )
    },
    startTone({ hz, duration, volume = DEFAULT_PLAYBACK_VOLUME } = {}) {
      return start('tone', { hz, duration }, volume)
    },
    startPlayBuffer(buffer, volume = 1) {
      return start('buffer', buffer, volume)
    },
    playStatus(id) {
      return operations.get(id)?.status ?? -1
    },
    playDetails(id) {
      const op = operations.get(id)
      const summarize = (error) =>
        error ? { code: error.code ?? 'IO', message: String(error.message).slice(0, 160) } : undefined
      return {
        quiet: op?.quiet ?? true,
        error: summarize(op?.error ?? (!op ? failure('CLOSED', 'Playback handle is closed') : undefined)),
        releaseError: summarize(op?.releaseError),
      }
    },
    stopPlay(id) {
      requestStop(operations.get(id), failure('CANCELLED', 'Playback cancelled'))
    },
    releasePlay,
    tone(options) {
      return result(bridge.startTone(options)).then(() => {})
    },
    play(buffer, volume) {
      return result(bridge.startPlayBuffer(buffer, volume))
    },
    suspend,
    resume() {
      if (closed) throw failure('CLOSED', 'Audio output bridge is closed')
      if (fault || active || suspending) throw fault ?? failure('BUSY', 'Audio output is still stopping')
      suspended = false
    },
    close() {
      if (!closing) {
        closed = true
        closing = suspend()
      }
      return closing
    },
  }
  return bridge
}
