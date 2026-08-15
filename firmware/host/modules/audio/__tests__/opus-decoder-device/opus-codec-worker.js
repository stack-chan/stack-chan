import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'

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
    if (encoder.inputBytes !== 1920) throw new Error(`unexpected Opus input bytes: ${encoder.inputBytes}`)
    if (encoder.outputBytes > 1275) throw new Error(`unexpected Opus output capacity: ${encoder.outputBytes}`)
    const simultaneousDecoder = new OpusDecoder(24000, 60)
    const input = new SharedArrayBuffer(encoder.inputBytes)
    new Uint8Array(input).set(new Uint8Array(message.pcm))
    const encoded = new SharedArrayBuffer(encoder.outputBytes)
    const encodedBytes = encoder.encode(input, encoded)
    simultaneousDecoder.close()
    const roundTripDecoder = new OpusDecoder(16000, 60)
    const roundTripPCM = new ArrayBuffer(roundTripDecoder.outputBytes)
    const roundTripBytes = roundTripDecoder.decode(new Uint8Array(encoded, 0, encodedBytes), roundTripPCM)
    if (roundTripBytes !== 1920) throw new Error(`unexpected round-trip PCM bytes: ${roundTripBytes}`)
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
