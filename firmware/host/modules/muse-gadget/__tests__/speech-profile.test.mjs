import assert from 'node:assert/strict'
import test from 'node:test'
import { createProfiledSpeech, createSpeechProfile, speechInstructions, speechVoices } from '../speech-profile.js'

test('voice choice restores only supported values and cycles without touching other settings', () => {
  const saved = []
  const profile = createSpeechProfile({ read: () => 'marin', write: (value) => saved.push(value) })
  assert.equal(profile.current(), 'marin')
  for (const voice of ['coral', 'shimmer', 'nova', 'marin']) assert.equal(profile.next(), voice)
  assert.deepEqual(saved, ['coral', 'shimmer', 'nova', 'marin'])
  assert.equal(createSpeechProfile({ read: () => 'untrusted' }).current(), 'marin')
  assert.equal(
    createSpeechProfile({
      read() {
        throw Error('unavailable')
      },
    }).current(),
    'marin',
  )
})

test('failed persistence leaves the current voice unchanged', () => {
  const profile = createSpeechProfile({
    write() {
      throw Error('full')
    },
  })
  assert.throws(() => profile.next(), /full/)
  assert.equal(profile.current(), 'marin')
})

test('all four presets use instruction-capable TTS and preserve playback options', async () => {
  const requests = [],
    scope = { signal: {} }
  let selected = 'marin'
  const tts = createProfiledSpeech(
    (options) => ({
      async open(playback) {
        const result = { options, playback }
        requests.push(result)
        return result
      },
    }),
    () => selected,
  )
  for (const voice of speechVoices) {
    selected = voice
    const result = await tts.open({ ...scope, voice: 'alloy', format: { sampleRate: 24000, channels: 1 } })
    assert.equal(result.options.model, 'gpt-4o-mini-tts')
    assert.equal(result.options.instructions, speechInstructions)
    assert.equal(result.playback.voice, voice)
    assert.equal(result.playback.signal, scope.signal)
    assert.equal(result.playback.format.sampleRate, 24000)
  }
  selected = 'invalid'
  assert.equal((await tts.open(scope)).playback.voice, 'marin')
  assert.equal(requests[0].playback.voice, 'marin')
})
