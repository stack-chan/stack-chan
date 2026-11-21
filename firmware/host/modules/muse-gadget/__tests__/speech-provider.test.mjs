import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpeechProfile } from '../speech-profile.js'
import {
  createSpeechProvider,
  createProfiledGeminiSpeech,
  geminiSpeechVoices,
  geminiSpeechInstructions,
} from '../speech-provider.js'

test('OpenAI stays default and missing Gemini key never changes provider or persistence', () => {
  let writes = 0
  const provider = createSpeechProvider({
    write() {
      writes++
    },
    hasGeminiKey: () => false,
  })
  assert.equal(provider.current(), 'openai')
  assert.throws(() => provider.next(), { code: 'gemini_key_missing' })
  assert.equal(provider.current(), 'openai')
  assert.equal(writes, 0)
})

test('provider switch is explicit, reversible, and atomic on persistence failure', () => {
  const values = []
  const provider = createSpeechProvider({ write: (value) => values.push(value), hasGeminiKey: () => true })
  assert.deepEqual(values, [])
  assert.equal(provider.next(), 'gemini')
  assert.equal(provider.next(), 'openai')
  assert.deepEqual(values, ['gemini', 'openai'])
  const failed = createSpeechProvider({
    write() {
      throw Error('full')
    },
    hasGeminiKey: () => true,
  })
  assert.throws(() => failed.next(), /full/)
  assert.equal(failed.current(), 'openai')
  assert.equal(createSpeechProvider({ read: () => 'invalid' }).current(), 'openai')
  assert.equal(createSpeechProvider({ read: () => 'gemini' }).current(), 'gemini')
})

test('Gemini voice choices remain separate and carry style without rewriting the transcript', async () => {
  const profile = createSpeechProfile({ voices: geminiSpeechVoices })
  assert.equal(profile.current(), 'Leda')
  let calls = 0
  const tts = createProfiledGeminiSpeech((options) => {
    calls++
    return { open: (playback) => ({ options, playback }) }
  }, profile.current)
  assert.equal(profile.next(), 'Zephyr')
  assert.equal(calls, 0)
  const opened = await tts.open({ voice: 'marin', format: { sampleRate: 24000 } })
  assert.equal(opened.options.model, 'gemini-3.8-flash-tts')
  assert.equal(opened.options.instructions, geminiSpeechInstructions)
  assert.equal(opened.playback.voice, 'Zephyr')
  assert.equal(opened.playback.format.sampleRate, 24000)
  assert.equal(createSpeechProfile().current(), 'marin')
})
