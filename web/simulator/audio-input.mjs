import {
  DEFAULT_RECORDING_DURATION_MS,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  RECORDING_GRACE_MS,
  RECORDING_PREPARE_TIMEOUT_MS,
  RECORDING_STOP_TIMEOUT_MS,
} from '../../firmware/contracts/audio-recording.js'

const formats = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/wav', extension: 'wav' },
]
const failure = (code, message, cause) => Object.assign(new Error(message, { cause }), { code })
const ioFailure = (error) => failure('IO', error?.message ?? String(error), error)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  // Polling firmware reads the result through its handle instead of awaiting it.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/** One browser input owner. Handles keep retired VMs from stopping a newer capture. */
export function createHostAudioInBridge({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorder = globalThis.MediaRecorder,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const operations = new Map()
  let nextId = 0
  let active
  let closed = false
  let suspended = false
  let fault
  let closing
  let suspending

  function format() {
    if (!mediaDevices?.getUserMedia || !MediaRecorder) return undefined
    return formats.find(
      (item) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(item.mimeType)
    )
  }
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
  function detachRecorder(op) {
    if (!op.recorder) return
    op.recorder.ondataavailable = op.recorder.onstop = op.recorder.onerror = null
  }
  function stopTracks(op) {
    const stream = op.stream
    op.stream = undefined
    if (!stream) return
    let tracks
    try {
      tracks = stream.getTracks()
    } catch (error) {
      op.cleanupFailure ??= ioFailure(error)
      return
    }
    for (const track of tracks) {
      try {
        track.stop()
      } catch (error) {
        op.cleanupFailure ??= ioFailure(error)
      }
    }
  }
  function settle(op, error) {
    if (op.settled) return
    clearTimers(op)
    if (op.cleanupFailure) {
      error = op.cleanupFailure
      fault ??= error
    }
    op.settled = true
    op.status = error ? -1 : 1
    op.error = error
    if (error) op.result.reject(error)
    else op.result.resolve(op.buffer)
  }
  function finishIfQuiet(op) {
    if (op.acquiring || op.reading || !op.recorderStopped) return
    clearTimers(op)
    if (op.cleanupFailure) {
      fault ??= op.cleanupFailure
      op.quiescence.reject(op.cleanupFailure)
      settle(op, op.cleanupFailure)
      return
    }
    op.recorder = undefined
    op.chunks = []
    op.quiet = true
    op.quiescence.resolve()
    if (active === op) active = undefined
    if (op.error || op.buffer) settle(op, op.error)
    if (op.released) operations.delete(op.id)
  }
  function stopDeadline(op, ms) {
    after(op, ms, () => {
      const error = failure(
        'TIMEOUT',
        'Microphone release could not be confirmed; restart after the pending request finishes'
      )
      fault ??= error
      op.quiescence.reject(error)
      settle(op, error)
      // The pending acquisition/conversion still owns its continuation. If it
      // completes later it closes its own tracks, never those of another handle.
    })
  }
  function requestStop(op, error) {
    if (!op || op.quiet) return
    if (error) op.error ??= error
    if (op.stopping || op.settled) {
      if (error || op.cleanupFailure) stopTracks(op)
      finishIfQuiet(op)
      return
    }
    op.stopping = true
    op.status = 2
    clearTimers(op)
    try {
      stopDeadline(op, error ? RECORDING_STOP_TIMEOUT_MS : RECORDING_GRACE_MS)
    } catch (caught) {
      op.cleanupFailure ??= ioFailure(caught)
    }
    try {
      if (op.recorder && !op.recorderStopped) {
        op.recorder.stop()
      }
    } catch (caught) {
      op.cleanupFailure ??= ioFailure(caught)
    } finally {
      if (error || op.cleanupFailure) stopTracks(op)
      if (op.cleanupFailure) {
        fault ??= op.cleanupFailure
        op.quiescence.reject(op.cleanupFailure)
        settle(op, op.cleanupFailure)
      }
      finishIfQuiet(op)
    }
  }
  async function collect(op) {
    let offset = 0
    const bytes = new Uint8Array(op.bytes)
    for (const chunk of op.chunks) {
      const buffer =
        chunk instanceof ArrayBuffer
          ? chunk
          : ArrayBuffer.isView(chunk)
            ? chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
            : await chunk.arrayBuffer()
      if (op.error || op.settled) return undefined
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > bytes.length - offset)
        throw failure('IO', 'Microphone returned inconsistent encoded data')
      bytes.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
    }
    if (!offset || offset !== bytes.length) throw failure('IO', 'Microphone returned no complete recording')
    if (
      op.format.extension === 'wav' &&
      (bytes.length < 12 ||
        String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
        String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE')
    )
      throw failure('IO', 'Microphone did not return a WAV recording')
    Object.defineProperties(bytes.buffer, {
      mimeType: { value: op.mimeType, configurable: true },
      filename: { value: `speak.${op.format.extension}`, configurable: true },
    })
    return bytes.buffer
  }
  function attachRecorder(op) {
    const recorder = (op.recorder = new MediaRecorder(op.stream, { mimeType: op.format.mimeType }))
    op.mimeType = recorder.mimeType || op.format.mimeType
    recorder.ondataavailable = (event) => {
      if (op.settled || op.error || op.recorderStopped) return
      try {
        const chunk = event.data
        const length = chunk?.byteLength ?? chunk?.size
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          !(chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk) || typeof chunk?.arrayBuffer === 'function')
        )
          throw failure('IO', 'Microphone returned an invalid data chunk')
        if (!length) return
        if (op.bytes + length > MAX_RECORDING_BYTES || op.chunks.length >= 256)
          throw failure('IO', 'Recording exceeds the bounded audio buffer')
        op.bytes += length
        op.chunks.push(chunk)
      } catch (error) {
        requestStop(op, error)
      }
    }
    recorder.onerror = (event) => requestStop(op, ioFailure(event.error ?? new Error('Microphone recorder failed')))
    recorder.onstop = () => {
      if (op.recorderStopped) return
      op.recorderStopped = true
      detachRecorder(op)
      stopTracks(op)
      if (!op.stopping) op.error ??= failure('IO', 'Microphone ended before the requested duration')
      if (op.error || op.settled || op.cleanupFailure) {
        finishIfQuiet(op)
        return
      }
      op.reading = true
      collect(op)
        .then(
          (buffer) => {
            if (!op.settled && !op.error) op.buffer = buffer
          },
          (error) => {
            op.error ??= ioFailure(error)
          }
        )
        .finally(() => {
          op.reading = false
          op.chunks = []
          finishIfQuiet(op)
        })
    }
    op.recorderStopped = false
    try {
      recorder.start(100)
    } catch (error) {
      if (recorder.state === 'inactive') {
        op.recorderStopped = true
        detachRecorder(op)
      }
      throw error
    }
    if (!op.stopping && !op.settled) after(op, op.durationMs, () => requestStop(op))
  }
  function startRecord(durationMs = DEFAULT_RECORDING_DURATION_MS) {
    // A retiring VM must not retain new handles after suspend's snapshot.
    if (suspended || operations.size >= 4) return 0
    do {
      nextId = (nextId % 0x7fffffff) + 1
    } while (operations.has(nextId))
    const op = {
      id: nextId,
      status: 0,
      durationMs,
      result: deferred(),
      quiescence: deferred(),
      timers: new Set(),
      chunks: [],
      bytes: 0,
      recorderStopped: true,
      acquiring: false,
      reading: false,
      quiet: false,
      stopping: false,
      settled: false,
    }
    operations.set(op.id, op)
    try {
      if (closed) throw failure('CLOSED', 'Microphone bridge is closed')
      if (fault) throw fault
      if (suspended || active) throw failure('BUSY', 'Microphone is already in use')
      if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > MAX_RECORDING_DURATION_MS)
        throw failure('INVALID_ARGUMENT', 'Recording duration must be between 1 and 15000 ms')
      op.format = format()
      if (!op.format) throw failure('UNSUPPORTED', 'Browser microphone recording is unavailable')
      active = op
      after(op, RECORDING_PREPARE_TIMEOUT_MS, () =>
        requestStop(op, failure('TIMEOUT', 'Microphone permission or preparation timed out'))
      )
      op.acquiring = true
      Promise.resolve()
        .then(() => {
          if (op.stopping || op.settled) return undefined
          return mediaDevices.getUserMedia({ audio: true })
        })
        .then((stream) => {
          op.acquiring = false
          op.stream = stream
          if (op.stopping || op.settled) {
            stopTracks(op)
            finishIfQuiet(op)
            return
          }
          if (!stream || typeof stream.getTracks !== 'function')
            throw failure('IO', 'Microphone returned no media stream')
          clearTimers(op)
          attachRecorder(op)
        })
        .catch((error) => {
          op.acquiring = false
          requestStop(op, error?.code ? error : ioFailure(error))
          finishIfQuiet(op)
        })
    } catch (error) {
      op.error = error
      finishIfQuiet(op)
    }
    return op.id
  }
  function releaseRecord(id) {
    const op = operations.get(id)
    if (!op) return
    op.released = true
    if (op.quiet) operations.delete(id)
    else requestStop(op, failure('CANCELLED', 'Recording released'))
  }
  async function suspend() {
    suspended = true
    if (suspending) return suspending
    suspending = (async () => {
      const owned = [...operations.values()]
      for (const op of owned) requestStop(op, failure('CANCELLED', 'Firmware recording stopped'))
      const results = await Promise.allSettled(owned.filter((op) => !op.quiet).map((op) => op.quiescence.promise))
      for (const op of owned) releaseRecord(op.id)
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
  return {
    recordAvailable() {
      return !closed && !fault && !!format()
    },
    startRecord,
    recordStatus(id) {
      return operations.get(id)?.status ?? -1
    },
    recordDetails(id) {
      const op = operations.get(id)
      const error = op?.error ?? (!op ? failure('CLOSED', 'Recording handle is closed') : undefined)
      return {
        quiet: op?.quiet ?? true,
        mimeType: op?.mimeType ?? '',
        filename: op?.format ? `speak.${op.format.extension}` : '',
        error: error
          ? { code: typeof error.code === 'string' ? error.code : 'IO', message: String(error.message).slice(0, 160) }
          : undefined,
      }
    },
    recordBuffer(id) {
      const op = operations.get(id)
      return op?.status === 1 ? op.buffer : undefined
    },
    stopRecord(id) {
      requestStop(operations.get(id), failure('CANCELLED', 'Recording cancelled'))
    },
    releaseRecord,
    async record(durationMs = DEFAULT_RECORDING_DURATION_MS) {
      const id = startRecord(durationMs)
      if (!id)
        throw failure(
          closed ? 'CLOSED' : 'BUSY',
          closed ? 'Microphone bridge is closed' : 'Microphone cannot accept a recording'
        )
      try {
        return await operations.get(id).result.promise
      } finally {
        releaseRecord(id)
      }
    },
    suspend,
    resume() {
      if (closed) throw failure('CLOSED', 'Microphone bridge is closed')
      if (fault || active || suspending) throw fault ?? failure('BUSY', 'Microphone is still stopping')
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
}
