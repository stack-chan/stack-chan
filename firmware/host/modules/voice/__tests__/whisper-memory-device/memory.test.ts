import type { Transcript } from 'stackchan/voice/contracts'
import { mono, writeSink } from 'stackchan/voice/media'
import { createVoiceScope } from 'stackchan/voice/scope'
import { createWhisperSTT } from 'stackchan/voice/speech'
import { equal } from 'testing/assert'

async function run() {
  const scope = createVoiceScope()
  let transcript: Transcript | undefined
  const session = await createWhisperSTT({ apiKey: 'test', maxAudioBytes: 194560 }).open({
    signal: scope.signal,
    format: mono(16000),
    utteranceId: 'memory-budget',
    onTranscript(value) {
      transcript = value
    },
  })
  const block = new Uint8Array(2048)
  for (let offset = 0; offset < block.length; offset++) block[offset] = offset & 255
  for (let count = 0; count < 95; count++) await writeSink(session.input, block)
  equal(transcript, undefined)
  await session.finish()
  equal(transcript?.utteranceId, 'memory-budget')
  equal(transcript?.text, 'recognized')
  equal(transcript?.final, true)
  await session.close()
}

run().then(
  () => trace('@@STACKCHAN_TEST:PASS@@\n'),
  (error) => {
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    throw error
  },
)
