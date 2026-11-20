import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder, { writePcmRing } from 'stackchanOpusEncoder'
import Timer from 'timer'

const INPUT_SAMPLE_RATE = 16000
const INPUT_FRAME_DURATION = 60
const EXPECTED_INPUT_BYTES = (INPUT_SAMPLE_RATE * INPUT_FRAME_DURATION * 2) / 1000
const PCM_RING_BYTES = EXPECTED_INPUT_BYTES * 32 + 2
const PCM_RING_STATE_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT

self.onmessage = (message) => {
  const codecs = []
  try {
    const packet = Uint8Array.fromBase64(
      'a0MGhCaZhd/53SR4JyZL0W/lRfnpC+EceQx31n7hDI24CfhTpPhU+K0V07m5HbUHtyxGM5aH0+F9eOohggfYpWiTTmc6YDtLbY1qKONrTM+oy8CShrjcog9BXhN0tSwXYER9IGBb+WaWyvjYjNemMNbMH/Yn0gkzTucZl9qdXeR2yK8M0BN6OUw4KXkTyOJYxMAcTVq9L2cZPWqqTpo6np02iA1asDZpuYGpXclKcFg1BAwDf8Ih62HchbAitifJR0n3/d+z+zgcpcQo+DsJKytqXuvBkMyeYDOeG45nWxD5hZgTtHwhC9HUAAAAAAAA',
    )
    const pcm = new ArrayBuffer(2880)
    const decoder = new OpusDecoder(24000, 60)
    codecs.push(decoder)
    const decodedBytes = decoder.decode(packet, pcm)
    if (decodedBytes !== pcm.byteLength) throw new Error(`unexpected Opus PCM bytes: ${decodedBytes}`)
    const decodeUs = decoder.decodeUs
    decoder.close()
    codecs.pop()

    const encoder = new OpusEncoder()
    codecs.push(encoder)
    if (encoder.inputBytes !== EXPECTED_INPUT_BYTES)
      throw new Error(`unexpected Opus input bytes: ${encoder.inputBytes}`)
    if (encoder.outputBytes !== 1275) throw new Error(`unexpected Opus output capacity: ${encoder.outputBytes}`)
    if (message.pcm.byteLength !== encoder.inputBytes)
      throw new Error(`unexpected PCM input bytes: ${message.pcm.byteLength}`)
    // Keep a decoder allocated while encoding to exercise concurrent codec memory pressure.
    const simultaneousDecoder = new OpusDecoder(24000, 60)
    codecs.push(simultaneousDecoder)
    const input = new SharedArrayBuffer(encoder.inputBytes)
    new Uint8Array(input).set(new Uint8Array(message.pcm))
    const stereo = new SharedArrayBuffer(input.byteLength * 2)
    const monoSamples = new Int16Array(input)
    const stereoSamples = new Int16Array(stereo)
    for (let index = 0; index < monoSamples.length; index++) {
      stereoSamples[index * 2] = monoSamples[index]
      stereoSamples[index * 2 + 1] = ~monoSamples[index]
    }

    const fullRing = new SharedArrayBuffer(PCM_RING_BYTES)
    const fullRingState = new SharedArrayBuffer(PCM_RING_STATE_BYTES)
    for (let frame = 0; frame < 32; frame++) {
      if (writePcmRing(fullRing, fullRingState, input, 0, input.byteLength, 1) !== input.byteLength)
        throw new Error(`PCM ring rejected frame ${frame}`)
    }
    if (writePcmRing(fullRing, fullRingState, input, 0, input.byteLength, 1) !== 0)
      throw new Error('full PCM ring accepted an extra frame')
    const fullStats = new Uint32Array(fullRingState)
    if (fullStats[2] !== input.byteLength * 33 || fullStats[3] !== input.byteLength)
      throw new Error(`unexpected PCM ring counters: captured=${fullStats[2]} dropped=${fullStats[3]}`)

    const pcmRing = new SharedArrayBuffer(PCM_RING_BYTES)
    const pcmRingState = new SharedArrayBuffer(PCM_RING_STATE_BYTES)
    encoder.attachPcmRing(pcmRing, pcmRingState)
    if (writePcmRing(pcmRing, pcmRingState, stereo, 0, stereo.byteLength, 2) !== input.byteLength)
      throw new Error('stereo PCM was not downmixed into the ring')
    const downmixed = new Int16Array(pcmRing, 0, monoSamples.length)
    for (let index = 0; index < monoSamples.length; index++) {
      if (downmixed[index] !== monoSamples[index]) throw new Error(`bad downmix at sample ${index}`)
    }
    const encoded = new SharedArrayBuffer(encoder.outputBytes)
    encoder.clear()
    let attempts = -20
    const timer = Timer.repeat(() => {
      let finished = false
      try {
        const encodedBytes = encoder.read(encoded)
        if (attempts < 0) {
          if (encodedBytes) throw new Error('Opus encoder returned a packet after clear')
          if (++attempts === 0) {
            if (writePcmRing(pcmRing, pcmRingState, input, 0, input.byteLength, 1) !== input.byteLength)
              throw new Error('PCM ring rejected the round-trip frame')
          }
          return
        }
        if (!encodedBytes) {
          if (++attempts < 200) return
          throw new Error('Opus encoder timed out')
        }
        Timer.clear(timer)
        finished = true
        simultaneousDecoder.close()
        codecs.pop()
        const roundTripDecoder = new OpusDecoder(INPUT_SAMPLE_RATE, INPUT_FRAME_DURATION)
        codecs.push(roundTripDecoder)
        const roundTripPCM = new ArrayBuffer(roundTripDecoder.outputBytes)
        const roundTripBytes = roundTripDecoder.decode(new Uint8Array(encoded, 0, encodedBytes), roundTripPCM)
        if (roundTripBytes !== EXPECTED_INPUT_BYTES)
          throw new Error(`unexpected round-trip PCM bytes: ${roundTripBytes}`)
        self.postMessage({
          decodedBytes,
          decodeUs,
          encodedBytes,
          encodeUs: encoder.encodeUs,
          internalHeapBytes: encoder.internalHeapBytes,
          psramHeapBytes: encoder.psramHeapBytes,
        })
      } catch (error) {
        Timer.clear(timer)
        finished = true
        self.postMessage({ error: String(error) })
      } finally {
        if (finished) {
          for (const codec of codecs) {
            try {
              codec.close()
            } catch {}
          }
        }
      }
    }, 10)
  } catch (error) {
    self.postMessage({ error: String(error) })
    for (const codec of codecs) {
      try {
        codec.close()
      } catch {}
    }
  }
}
