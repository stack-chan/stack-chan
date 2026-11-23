export const slotBytes = 2048
export const slotCount = 4
const native24kSlotBytes = 6144

export function pcmSlotBytes(nativeTransport, sampleRate) {
  return nativeTransport === true && sampleRate === 24000 ? native24kSlotBytes : slotBytes
}

function status(code) {
  return Object.assign(new Error(code), { code })
}

export function runWorkerJob(job, connection, { spawn, schedule, clear }) {
  return new Promise((resolve, reject) => {
    if (job.signal.aborted) return reject(job.signal.reason ?? status('cancelled'))
    const lifecycle = (phase) => {
      try {
        connection.onLifecycle?.(phase)
      } catch {}
    }
    lifecycle('start')
    const bytesPerSlot = pcmSlotBytes(connection.nativeTransport, job.sampleRate)
    let ring, slots, worker
    try {
      ring = new SharedArrayBuffer(slotCount * bytesPerSlot)
      slots = Array.from({ length: slotCount }, (_, i) => new Uint8Array(ring, i * bytesPerSlot, bytesPerSlot))
      worker = spawn()
    } catch (error) {
      lifecycle('allocation_failed')
      throw error
    }
    lifecycle('spawned')
    let stopped = false,
      terminated = false,
      reap,
      receiving = Promise.resolve(),
      next = 0
    const terminate = () => {
      if (terminated) return
      terminated = true
      if (reap !== undefined) clear(reap)
      worker.terminate()
    }
    const stop = (error, notifyWorker) => {
      if (stopped) return
      stopped = true
      job.signal.removeEventListener('abort', abort)
      if (notifyWorker) {
        try {
          // TLSの遅延closeが完了するまではWorkerを解放しない
          reap = schedule(terminate, 1000)
          worker.postMessage({ type: 'cancel' })
        } catch {
          terminate()
        }
      } else terminate()
      if (error) reject(error)
      else resolve()
    }
    const abort = () => stop(job.signal.reason ?? status('cancelled'), true)
    job.signal.addEventListener('abort', abort)
    const replayDiagnostics = (message) => {
      if (!Array.isArray(message.diagnostics)) return
      for (const item of message.diagnostics.slice(0, 12)) {
        try {
          if (item.type === 'metrics') job.onMetrics?.(item.values)
          else if (item.type === 'diagnostic') job.onFailure?.(item.reason)
          else if (item.type === 'transport') connection.onTransport?.(item.values)
        } catch {}
      }
    }
    worker.onmessage = (message) => {
      if (stopped) {
        if (message.type === 'done' || message.type === 'error') terminate()
        return
      }
      if (message.type === 'pcm') {
        const { slot, length, seq } = message
        if (
          seq !== next ||
          slot !== next % slotCount ||
          !Number.isInteger(length) ||
          length < 2 ||
          length > bytesPerSlot ||
          length % 2
        )
          return stop(status('provider_failed'), true)
        next++
        receiving = receiving
          .then(async () => {
            if (stopped) return
            await job.onPcm(slots[slot].subarray(0, length))
            if (!stopped) worker.postMessage({ type: 'ack', seq })
          })
          .catch((error) => stop(error, true))
      } else if (message.type === 'metrics') {
        try {
          job.onMetrics?.(message.values)
        } catch {}
      } else if (message.type === 'diagnostic') {
        try {
          job.onFailure?.(message.reason)
        } catch {}
      } else if (message.type === 'transport') {
        try {
          connection.onTransport?.(message.values)
        } catch {}
      } else if (message.type === 'error') {
        lifecycle('error')
        replayDiagnostics(message)
        stop(status(message.code), false)
      } else if (message.type === 'done') {
        lifecycle('done')
        replayDiagnostics(message)
        receiving.then(() => stop(undefined, false))
      }
    }
    try {
      const { endpoint, apiKey, transportTimeoutMs } = connection
      const { text, voice, model, instructions, maxEventBytes, sampleRate } = job
      lifecycle('dispatch')
      worker.postMessage({
        type: 'start',
        ring,
        endpoint,
        apiKey,
        transportTimeoutMs,
        nativeTransport: connection.nativeTransport === true,
        reportTransport: !!connection.onTransport,
        text,
        voice,
        model,
        instructions,
        maxEventBytes,
        sampleRate,
      })
    } catch (error) {
      stop(error, false)
    }
  })
}

export function createSlotWriter(ring, send, now, bytesPerSlot = slotBytes) {
  if (
    !(ring instanceof SharedArrayBuffer) ||
    (bytesPerSlot !== slotBytes && bytesPerSlot !== native24kSlotBytes) ||
    ring.byteLength !== slotCount * bytesPerSlot
  )
    throw status('provider_failed')
  const metrics = now ? { waits: 0, waitTotal: 0, waitMax: 0, postGapMax: 0 } : undefined
  let lastPost
  let issued = 0,
    returned = 0,
    wake,
    closed = false
  const changed = () => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }
  const wait = () =>
    new Promise((resolve) => {
      wake = resolve
    })
  const check = () => {
    if (closed) throw status('cancelled')
  }
  function post(bytes, stalled) {
    check()
    const seq = issued++,
      slot = seq % slotCount
    new Uint8Array(ring, slot * bytesPerSlot, bytes.length).set(bytes)
    if (now) {
      const tick = now()
      if (stalled !== undefined) {
        const waitMs = (tick - stalled) >>> 0
        metrics.waits++
        metrics.waitTotal += waitMs
        metrics.waitMax = Math.max(metrics.waitMax, waitMs)
      }
      if (lastPost !== undefined) metrics.postGapMax = Math.max(metrics.postGapMax, (tick - lastPost) >>> 0)
      lastPost = tick
    }
    send({ type: 'pcm', seq, slot, length: bytes.length })
  }
  async function writeWhenAvailable(bytes, stalled) {
    while (issued - returned >= slotCount) {
      check()
      await wait()
    }
    post(bytes, stalled)
  }
  function writeImmediate(bytes) {
    if (!bytes.length || bytes.length > bytesPerSlot || bytes.length % 2) throw status('provider_failed')
    check()
    if (issued - returned >= slotCount) return writeWhenAvailable(bytes, now?.())
    post(bytes)
  }
  return {
    metrics,
    writeImmediate,
    async write(bytes) {
      return writeImmediate(bytes)
    },
    ack(seq) {
      if (seq !== returned || returned >= issued) throw status('provider_failed')
      returned++
      changed()
    },
    async drain() {
      while (issued !== returned) {
        check()
        await wait()
      }
      check()
    },
    cancel() {
      closed = true
      changed()
    },
  }
}

export function createWorkerDiagnostics() {
  const pending = []
  return {
    add(message) {
      if (!['transport', 'metrics', 'diagnostic'].includes(message.type)) throw status('provider_failed')
      if (pending.length === 12) pending.shift()
      pending.push(message)
    },
    finish(type, code) {
      const message = { type }
      if (code !== undefined) message.code = code
      if (pending.length) message.diagnostics = pending.splice(0)
      return message
    },
  }
}
