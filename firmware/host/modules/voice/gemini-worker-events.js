const searchLF = (bytes, offset) => bytes.indexOf(10, offset)
const failure = (code = 'provider_failed') => Object.assign(new Error(code), { code })

export function createSpeechEvents({
  maxEventBytes = 65536,
  onPcm,
  now,
  findLF = searchLF,
  sampleRate = 24000,
  pcmChunkBytes = 2048,
}) {
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 256 || maxEventBytes > 65536)
    throw new RangeError('invalid audio event limit')
  if (!Number.isSafeInteger(pcmChunkBytes) || pcmChunkBytes < 2 || pcmChunkBytes % 2)
    throw new RangeError('invalid PCM chunk size')
  if (typeof onPcm !== 'function') throw new TypeError('missing PCM consumer')
  const metrics = { maxEventChars: 0, pcmBytes: 0 }
  const stages = now ? [0, 0, 0, 0, 0] : undefined
  if (stages) {
    metrics.stageMs = stages
    metrics.framing = {
      calls: 0,
      bytes: 0,
      scans: 0,
      scanMs: 0,
      scanMax: 0,
      copyMs: 0,
      totalMs: 0,
      maxMs: 0,
      frames: 0,
    }
  }
  let storage = new Uint8Array(Math.min(1024, maxEventBytes))
  let used = 0,
    lineStart = 0,
    completed = false,
    odd,
    finished = false,
    failed = false

  async function dispatch() {
    if (now) metrics.framing.frames++
    let t = now?.()
    const text = String.fromArrayBuffer(storage.buffer, 0, used)

    let data, parts
    for (let start = 0; start < text.length; ) {
      const lf = text.indexOf('\n', start)
      const end = lf < 0 ? text.length : lf > start && text.charCodeAt(lf - 1) === 13 ? lf - 1 : lf
      if (text.startsWith('data:', start)) {
        let content = start + 5
        if (content < end && text.charCodeAt(content) === 32) content++
        const part = text.slice(content, end)
        if (data === undefined) data = part
        else {
          parts ??= [data]
          parts.push(part)
        }
      }
      if (lf < 0) break
      start = lf + 1
    }
    if (parts) data = parts.join('\n')
    if (now) stages[0] += now() - t
    used = 0
    lineStart = 0
    if (!data || (completed && data === '[DONE]')) return
    metrics.maxEventChars = Math.max(metrics.maxEventChars, data.length)
    let event
    try {
      t = now?.()
      event = JSON.parse(data)
      if (now) stages[1] += now() - t
    } catch {
      throw failure()
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw failure()
    if (completed) throw failure()
    if (event.event_type === 'error' || event.event_type === 'interaction.failed') throw failure()
    if (event.event_type === 'interaction.completed') {
      if (event.interaction?.status !== 'completed' || odd !== undefined || !metrics.pcmBytes) throw failure()
      completed = true
      return
    }
    if (event.event_type !== 'step.delta' || event.delta?.type !== 'audio') return
    const { data: base64, mime_type: mime } = event.delta
    if (sampleRate === 16000) {
      if (typeof mime !== 'string' || mime.length > 40 || !/^audio\/l16;\s*rate=16000(?:;\s*channels=1)?$/i.test(mime))
        throw failure('unsupported_capability')
    } else if (
      mime !== undefined &&
      (typeof mime !== 'string' || mime.length > 32 || !/^audio\/l16(?:;rate=24000)?(?:;channels=1)?$/i.test(mime))
    )
      throw failure('unsupported_capability')
    t = now?.()
    if (typeof base64 !== 'string' || !base64.length || base64.length % 4) throw failure()
    if (now) stages[2] += now() - t
    if (typeof Uint8Array.fromBase64 !== 'function') throw failure('unsupported_capability')
    let decoded
    try {
      t = now?.()
      decoded = Uint8Array.fromBase64(base64, { lastChunkHandling: 'strict' })
    } catch {
      throw failure()
    }
    if (now) stages[3] += now() - t
    t = now?.()
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    if (decoded.length !== (base64.length / 4) * 3 - padding) throw failure()
    let offset = 0
    if (odd !== undefined) {
      const pending = onPcm(Uint8Array.of(odd, decoded[0]))
      if (pending != null && typeof pending.then === 'function') await pending
      metrics.pcmBytes += 2
      odd = undefined
      offset = 1
    }
    while (offset + 1 < decoded.length) {
      const count = Math.min(pcmChunkBytes, (decoded.length - offset) & ~1)
      const pending = onPcm(decoded.subarray(offset, offset + count))
      if (pending != null && typeof pending.then === 'function') await pending
      metrics.pcmBytes += count
      offset += count
    }
    if (offset < decoded.length) odd = decoded[offset]
    if (now) stages[4] += now() - t
  }

  return {
    metrics,
    isComplete: () => completed && !failed,
    async feed(bytes) {
      if (finished || failed) throw failure()
      const started = now?.()
      const m = metrics.framing
      if (m) {
        m.calls++
        m.bytes += bytes.length
      }
      try {
        let offset = 0
        while (offset < bytes.length) {
          let start = now?.()
          const newline = findLF(bytes, offset)
          if (m) {
            const dt = (now() - start) >>> 0
            m.scans++
            m.scanMs += dt
            m.scanMax = Math.max(m.scanMax, dt)
            start = now()
          }
          const end = newline < 0 ? bytes.length : newline + 1
          const length = used + end - offset
          if (length > maxEventBytes) throw failure('resource_exhausted')
          if (length > storage.length) {
            let capacity = storage.length
            while (capacity < length) capacity = Math.min(maxEventBytes, capacity * 2)
            const next = new Uint8Array(capacity)
            next.set(storage.subarray(0, used))
            storage = next
          }
          storage.set(bytes.subarray(offset, end), used)
          if (m) m.copyMs += (now() - start) >>> 0
          used = length
          offset = end
          if (newline < 0) continue
          const empty = used - lineStart === 1 || (used - lineStart === 2 && storage[used - 2] === 13)
          lineStart = used
          if (empty) await dispatch()
        }
      } catch (error) {
        failed = true
        throw error
      } finally {
        if (m) {
          const dt = (now() - started) >>> 0
          m.totalMs += dt
          m.maxMs = Math.max(m.maxMs, dt)
        }
      }
    },
    async finish() {
      if (failed) throw failure()
      if (finished) return
      try {
        if (used) await dispatch()
        if (!completed || odd !== undefined || !metrics.pcmBytes) throw failure()
        finished = true
      } catch (error) {
        failed = true
        throw error
      }
    },
  }
}
