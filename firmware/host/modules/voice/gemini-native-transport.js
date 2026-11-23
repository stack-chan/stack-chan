export const geminiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const failure = (code = 'provider_failed') => Object.assign(new Error(code), { code })

// The native task owns its input copies. Only this bounded buffer crosses back into XS.
export function createNativeSpeechTransport(endpoint, apiKey, timeoutMs, { Reader, pause, now, onDiagnostic }) {
  if (endpoint !== geminiEndpoint) throw new TypeError('Unsupported native speech endpoint')
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{20,512}$/.test(apiKey))
    throw new TypeError('Invalid native speech credential')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
    throw new RangeError('Invalid native speech deadline')
  return async (body, feed, { signal }) => {
    if (signal.aborted) throw signal.reason ?? failure('cancelled')
    if (!Number.isInteger(body.length) || body.length < 1 || body.length > 32768) throw failure('resource_exhausted')
    const bytes = new Uint8Array(body.length)
    let offset = 0
    for (const part of body.read()) {
      if (!(part instanceof Uint8Array) || !part.length || part.length > bytes.length - offset)
        throw failure('resource_exhausted')
      bytes.set(part, offset)
      offset += part.length
    }
    if (offset !== bytes.length) throw failure()
    let reader,
      constructorReason = 0
    const report = () => {
      try {
        const value = reader?.diagnostic?.() ?? 0
        const transport = reader?.transportDiagnostic?.() ?? 0
        const openClass = Math.floor(transport / 100),
          errnoClass = transport % 100
        if (!Number.isInteger(transport) || openClass < 0 || openClass > 6 || errnoClass < 0 || errnoClass > 7) return
        const stage = Math.floor(value / 1000000),
          reason = Math.floor(value / 1000) % 1000,
          http = value % 1000
        if (
          Number.isInteger(value) &&
          stage >= 0 &&
          stage <= 8 &&
          reason <= 17 &&
          (http === 0 || (http >= 100 && http <= 599))
        )
          onDiagnostic?.([7, value, constructorReason, transport, 0, 0, 0, 0, 0, 0])
      } catch {}
    }
    const started = now()
    const check = () => {
      if (signal.aborted) throw signal.reason ?? failure('cancelled')
      if ((now() - started) >>> 0 >= timeoutMs) throw failure('deadline_exceeded')
    }
    const abort = () => reader?.close()
    signal.addEventListener('abort', abort)
    try {
      check()
      try {
        reader = new Reader(endpoint, apiKey, bytes, timeoutMs)
      } catch (error) {
        const match = /^Speech native unavailable \(([1-7])\)$/.exec(error?.message)
        constructorReason = match ? Number(match[1]) : 0
        throw failure()
      }
      bytes.fill(0)
      const buffer = new Uint8Array(4096)
      while (true) {
        check()
        const length = reader.read(buffer)
        if (length === -2) {
          await pause(5)
          continue
        }
        if (length === -3) throw failure('deadline_exceeded')
        if (length === -4) throw failure('resource_exhausted')
        if (!Number.isInteger(length) || length < 0 || length > buffer.length) throw failure()
        if (!length) break
        await feed(buffer.subarray(0, length))
        // Yield to worker messages even when the native queue and PCM credits are full.
        await pause(0)
      }
      check()
    } finally {
      report()
      bytes.fill(0)
      signal.removeEventListener('abort', abort)
      reader?.close()
    }
  }
}
