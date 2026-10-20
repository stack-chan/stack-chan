import Transport from 'realtimeConversation/transport'
import MP3Decoder from 'test-mp3-decoder'
import OpusDecoder from 'test-opus-decoder'
import OpusEncoder from 'test-opus-encoder'
import { equal } from 'testing/assert'

function exerciseCodecs() {
  const codecs = []
  try {
    codecs.push(new MP3Decoder())
    codecs.push(new OpusDecoder(16000, 60))
    const encoder = new OpusEncoder()
    codecs.push(encoder)
    equal(encoder.capturedPcmBytes, 0, 'new encoder has no captured PCM')
    equal(encoder.droppedPcmBytes, 0, 'new encoder has no dropped PCM')
  } finally {
    for (const codec of codecs.reverse()) codec.close()
  }
}

async function run() {
  // Construct the actual optimized codecs with no setup/realtime-performance
  // module and no earlier transport. This used to dereference unset allocators.
  exerciseCodecs()
  const transport = new Transport(() => {})
  // No start(): this contract test opens no I2S or network session.
  await transport.close()
  exerciseCodecs()
  trace('@@STACKCHAN_TEST:PASS@@\n')
}

run().catch((error) => {
  trace(`${String(error)}\n`)
  trace('@@STACKCHAN_TEST:FAIL@@\n')
})
