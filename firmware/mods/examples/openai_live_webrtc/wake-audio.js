const format = { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 }
const budget = { maxBufferedMs: 100, maxBufferedBytes: 6400 }

/** Standby receives only local PCM. Its owner cannot stream to the new conversation. */
export async function openLocalWake(
  { microphone, speaker, createScope, createDetector, readSource, onWake, onEnd },
  scope,
) {
  const local = createScope()
  let lease, detector, reader, closing
  let feeding = true
  const owner = {
    close() {
      if (!closing) {
        feeding = false
        closing = Promise.resolve().then(async () => {
          // Each step is attempted. Never report that audio is free if a stop cannot be verified.
          let failed = false
          for (const release of [
            () => reader?.close(),
            () => local.abort(),
            () => detector?.close(),
            () => lease?.close(),
          ]) {
            try {
              await release()
            } catch {
              failed = true
            }
          }
          if (failed) throw new Error('Wake audio release unconfirmed')
        })
      }
      return closing
    },
  }
  try {
    lease = await microphone.runtime.acquire(
      microphone,
      speaker,
      { input: [format], output: [format], duplex: 'half', preRollMs: 0 },
      { ...local, budget },
    )
    if (!scope.isCurrent()) return owner
    if (
      lease.input.format.encoding !== format.encoding ||
      lease.input.format.sampleRate !== format.sampleRate ||
      lease.input.format.channels !== format.channels
    )
      throw new Error('Wake PCM format unavailable')
    detector = createDetector()
    detector.start()
    if (!scope.isCurrent()) return owner
    const ended = () => {
      if (!feeding || !scope.isCurrent()) return
      feeding = false
      onEnd()
    }
    reader = readSource(
      lease.input,
      (bytes) => {
        if (!feeding || !scope.isCurrent()) return
        let detected
        try {
          if (!bytes.byteLength || bytes.byteLength % 2 || bytes.byteLength > 2048)
            throw new Error('Invalid Wake PCM frame')
          detected = detector.detect(bytes)
        } catch {
          ended()
          return
        }
        if (detected) {
          feeding = false
          onWake()
        }
      },
      ended,
      ended,
    )
  } catch (error) {
    await owner.close()
    if (lease) {
      // Fault after acquiring: notify and return the positively released lease,
      // not a false claim that ownership was never acquired.
      if (scope.isCurrent()) onEnd()
    } else {
      // The runtime reports device_busy before any local claim. Other failures
      // can come from a partial capture open with uncertain hardware ownership.
      if (error?.code !== 'device_busy') throw error
      return { status: 'unavailable', ownership: 'not-acquired' }
    }
  }
  return owner
}
