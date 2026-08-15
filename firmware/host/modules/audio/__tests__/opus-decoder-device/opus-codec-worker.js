import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'

const INPUT_SAMPLE_RATE = 16000
const INPUT_FRAME_DURATION = 60
const EXPECTED_INPUT_BYTES = (INPUT_SAMPLE_RATE * INPUT_FRAME_DURATION * 2) / 1000

self.onmessage = (message) => {
  try {
    const packet = Uint8Array.fromBase64(
      'a0MGhCaZhd/53SR4JyZL0W/lRfnpC+EceQx31n7hDI24CfhTpPhU+K0V07m5HbUHtyxGM5aH0+F9eOohggfYpWiTTmc6YDtLbY1qKONrTM+oy8CShrjcog9BXhN0tSwXYER9IGBb+WaWyvjYjNemMNbMH/Yn0gkzTucZl9qdXeR2yK8M0BN6OUw4KXkTyOJYxMAcTVq9L2cZPWqqTpo6np02iA1asDZpuYGpXclKcFg1BAwDf8Ih62HchbAitifJR0n3/d+z+zgcpcQo+DsJKytqXuvBkMyeYDOeG45nWxD5hZgTtHwhC9HUAAAAAAAA',
    )
    const pcm = new ArrayBuffer(2880)
    const decoder = new OpusDecoder(24000, 60)
    const decodedBytes = decoder.decode(packet, pcm)
    if (decodedBytes !== pcm.byteLength) throw new Error(`unexpected Opus PCM bytes: ${decodedBytes}`)
    const decodeUs = decoder.decodeUs
    decoder.close()

    const encoder = new OpusEncoder()
    if (encoder.inputBytes !== EXPECTED_INPUT_BYTES)
      throw new Error(`unexpected Opus input bytes: ${encoder.inputBytes}`)
    if (encoder.outputBytes > 1275) throw new Error(`unexpected Opus output capacity: ${encoder.outputBytes}`)
    if (message.pcm.byteLength !== encoder.inputBytes)
      throw new Error(`unexpected PCM input bytes: ${message.pcm.byteLength}`)
    // Keep a decoder allocated while encoding to exercise concurrent codec memory pressure.
    const simultaneousDecoder = new OpusDecoder(24000, 60)
    const input = new SharedArrayBuffer(encoder.inputBytes)
    new Uint8Array(input).set(new Uint8Array(message.pcm))
    const encoded = new SharedArrayBuffer(encoder.outputBytes)
    const encodedBytes = encoder.encode(input, encoded)
    simultaneousDecoder.close()
    const roundTripDecoder = new OpusDecoder(INPUT_SAMPLE_RATE, INPUT_FRAME_DURATION)
    const roundTripPCM = new ArrayBuffer(roundTripDecoder.outputBytes)
    const roundTripBytes = roundTripDecoder.decode(new Uint8Array(encoded, 0, encodedBytes), roundTripPCM)
    if (roundTripBytes !== EXPECTED_INPUT_BYTES) throw new Error(`unexpected round-trip PCM bytes: ${roundTripBytes}`)
    self.postMessage({
      decodedBytes,
      decodeUs,
      encodedBytes,
      encodeUs: encoder.encodeUs,
      internalHeapBytes: encoder.internalHeapBytes,
      psramHeapBytes: encoder.psramHeapBytes,
    })
    encoder.close()
    roundTripDecoder.close()
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
