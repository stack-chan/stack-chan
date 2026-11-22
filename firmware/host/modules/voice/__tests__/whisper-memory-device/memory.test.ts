import type { Transcript } from 'stackchan/voice/contracts'
import { mono, writeSink } from 'stackchan/voice/media'
import { createVoiceScope } from 'stackchan/voice/scope'
import { WhisperSTT } from 'stackchan/voice/speech'
import { releaseTranscription, transcribing } from 'stt-whisper'
import { equal } from 'testing/assert'

async function run() {
  const scope = createVoiceScope()
  let transcript: Transcript | undefined
  const session = await WhisperSTT.create({ apiKey: 'test', maxAudioBytes: 194560 }).open({
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
  const completed = session.finish()
  equal(session.finish(), completed)
  await completed
  equal(transcript?.utteranceId, 'memory-budget')
  equal(transcript?.text, 'recognized')
  equal(transcript?.final, true)
  await session.close()
}

async function closeWhileTranscribing() {
  const scope = createVoiceScope()
  let transcript: Transcript | undefined
  const session = await WhisperSTT.create({ apiKey: 'test', model: 'delayed', maxAudioBytes: 2 }).open({
    signal: scope.signal,
    format: mono(16000),
    utteranceId: 'delayed',
    onTranscript(value) {
      transcript = value
    },
  })
  await writeSink(session.input, Uint8Array.of(1, 0))
  const completed = session.finish().then(
    () => {
      throw new Error('cancelled transcription succeeded')
    },
    (error) => equal(error.code, 'cancelled'),
  )
  await transcribing.promise
  let closed = false
  const closing = session.close().then(() => {
    closed = true
  })
  try {
    await Promise.resolve()
    equal(closed, false)
  } finally {
    releaseTranscription.resolve()
  }
  await completed
  await closing
  equal(transcript, undefined)
}

run()
  .then(closeWhileTranscribing)
  .then(
    () => trace('@@STACKCHAN_TEST:PASS@@\n'),
    (error) => {
      trace('@@STACKCHAN_TEST:FAIL@@\n')
      throw error
    },
  )
