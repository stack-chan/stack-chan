const format = Object.freeze({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 })
const failure = (code) => Object.assign(new Error(code), { code })

export function createMuseNotePlayer({ Decoder, scan, id3Size, resample, createPcmSource }) {
  return async function playReply(message, { backend, media, signal, generation, fencePlayback, onMetrics, onPlaybackState }) {
    const active = () => {
      if (signal.aborted) throw failure('cancelled')
    }
    active()
    if (!Number.isSafeInteger(generation) || generation < 0) throw failure('provider_failed')
    let rejectAbort
    const aborted = new Promise((_, reject) => {
      rejectAbort = reject
    })
    void aborted.catch(() => {})
    let playbackActive = false
    const playback = value => {
      if (playbackActive === value) return
      playbackActive = value
      onPlaybackState?.(value)
    }
    let receipts,
      cleanupFailed = false
    let producer,
      decoder,
      link,
      fenceTask,
      started = false,
      finished = false
    const fence = fencePlayback ?? (() => media.output.fence(generation + 1))
    const abort = () => {
      const error = failure('cancelled')
      playback(false)
      producer?.end(error)
      if (started) {
        fenceTask = Promise.resolve().then(fence)
        void fenceTask.catch(() => {})
      }
      rejectAbort(error)
    }
    signal.addEventListener('abort', abort)
    const wait = (promise) => Promise.race([promise, aborted])
    try {
      active()
      const bytes = new Uint8Array(await wait(backend.readTts(message.id, { signal })))
      active()
      if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw failure('resource_exhausted')
      const skip = id3Size(bytes)
      if (skip === undefined || skip > bytes.length || skip > 65536) throw failure('provider_failed')
      let position = skip,
        frames = 0, emptyFrames = 0, emptyAfterAudio = 0,
        produced = 0
      decoder = new Decoder()
      producer = createPcmSource(format)
      const outputId = `${message.id}/muse-tts`
      const sink = media.output.begin(outputId, generation)
      started = true
      // A late media connection still belongs to this operation after cancellation.
      const connecting = media.media.connect(producer.output, sink, { signal, budget: media.output.budget })
      link = await connecting
      void link.done.catch(() => {})
      active()
      playback(true)
      const decoded = new ArrayBuffer(1152 * 2)
      const converted = new ArrayBuffer(1154 * 2)
      const state = new Int32Array(3)
      const push = async (count) => {
        if (!Number.isInteger(count) || count < 0 || count > 1154) throw failure('provider_failed')
        produced += count
        if (produced > 16000 * 120) throw failure('resource_exhausted')
        if (count) await wait(producer.push(new Uint8Array(converted, 0, count * 2)))
        active()
      }
      while (position < bytes.length) {
        active()
        if (
          bytes.length - position === 128 &&
          bytes[position] === 84 &&
          bytes[position + 1] === 65 &&
          bytes[position + 2] === 71
        )
          break
        const frame = scan(bytes, position, bytes.length, {})
        if (
          !frame ||
          frame.position !== position ||
          frame.length < 4 ||
          position + frame.length > bytes.length ||
          frame.sampleRate !== 24000 ||
          frame.channels !== 1
        )
          throw failure('provider_failed')
        const consumed = decoder.decode(bytes.subarray(position, position + frame.length), decoded)
        if (
          consumed !== frame.length ||
          !Number.isInteger(decoded.samples) ||
          decoded.samples < 0 ||
          decoded.samples > 1152
        )
          throw failure('provider_failed')
        if (!decoded.samples) { emptyFrames++; if (produced) emptyAfterAudio++; }
        if (decoded.samples) {
          if (decoded.sampleRate !== 24000) throw failure('provider_failed')
          await push(resample(decoded, 0, decoded.samples, converted, 24000, 16000, state))
        }
        position += frame.length
        frames++
      }
      onMetrics?.({ frames, emptyFrames, emptyAfterAudio, producedFrames: produced })
      if (!frames || !produced) throw failure('provider_failed')
      if (state[2]) {
        const tail = new Int16Array([state[1]])
        await push(resample(tail.buffer, 0, 1, converted, 24000, 16000, state))
      }
      producer.end()
      await wait(link.done)
      active()
      const receipt = await wait(media.output.finish(outputId))
      active()
      finished = true
      receipts = [receipt]
    } finally {
      signal.removeEventListener('abort', abort)
      playback(false)
      producer?.end(finished ? undefined : failure('cancelled'))
      if (started && !finished && !fenceTask)
        fenceTask = Promise.resolve().then(fence)
      const results = await Promise.allSettled([
        Promise.resolve().then(() => link?.close()),
        Promise.resolve().then(() => decoder?.close()),
        fenceTask,
      ])
      cleanupFailed = results.some((result) => result.status === 'rejected')
    }
    if (cleanupFailed) throw failure('provider_failed')
    return receipts
  }
}
