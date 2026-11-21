import { createAudioRuntime } from 'stackchan/voice/device'
import { createPcmSink, createPcmSource } from 'stackchan/voice/media'
import Timer from 'timer'

const format = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }
const requirements = { input: [format], output: [format], duplex: 'half' }
const budget = { maxBufferedMs: 500, maxBufferedBytes: 24576 }
const signal = { aborted: false, addEventListener() {}, removeEventListener() {} }
const wait = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
let exclusive = false
const runtime = createAudioRuntime({
  volume: 0.1,
  acquireExclusive() {
    if (exclusive) throw new Error('busy')
    exclusive = true
    return () => {
      exclusive = false
    }
  },
})

async function smoke() {
  let lease, link
  try {
    lease = await runtime.acquire(runtime.microphone, runtime.speaker, requirements, { budget, signal })
    let samples = 0,
      peak = 0,
      sumSquares = 0,
      nonzero = 0
    const sink = createPcmSink(format, (bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let i = 0; i < bytes.length; i += 2) {
        const value = view.getInt16(i, true)
        samples++
        peak = Math.max(peak, Math.abs(value))
        sumSquares += value * value
        if (value) nonzero++
      }
    })
    link = await lease.media.connect(lease.input, sink, { budget, signal })
    let inputError
    void link.done.catch((error) => {
      inputError = error
    })
    await wait(1000)
    await link.close()
    link = undefined
    await lease.setInputEnabled(false)
    if (inputError) throw inputError
    trace(
      `MUSE_AUDIO_CAPTURE samples=${samples} nonzero=${nonzero} peak=${peak} rms=${Math.round(Math.sqrt(sumSquares / Math.max(1, samples)))}\n`,
    )
    if (!samples) throw new Error('no microphone callbacks')
    const source = createPcmSource(format)
    const target = lease.output.begin('audio-smoke', 0)
    link = await lease.media.connect(source.output, target, { budget, signal })
    const tone = new Uint8Array(3200)
    const view = new DataView(tone.buffer)
    for (let i = 0; i < 1600; i++)
      view.setInt16(i * 2, Math.round(500 * Math.sin((2 * Math.PI * 440 * i) / 16000)), true)
    await source.push(tone)
    source.end()
    await link.done
    const receipt = await lease.output.finish('audio-smoke')
    trace(`MUSE_AUDIO_DRAIN ${JSON.stringify(receipt)}\n`)
    await link.close()
    link = undefined
    await lease.close()
    lease = undefined
    const again = await runtime.acquire(runtime.microphone, runtime.speaker, requirements, { budget, signal })
    await again.close()
    trace('MUSE_AUDIO_RELEASE_REACQUIRE_PASS\n')
  } finally {
    await link?.close()
    await lease?.close()
  }
}
smoke().catch((error) => trace(`MUSE_AUDIO_FAIL ${error}\n`))
