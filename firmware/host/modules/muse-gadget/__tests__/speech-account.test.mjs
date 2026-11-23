import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const fixture = { keys: {}, reads: [], transports: [] }
globalThis.__speechAccountFixture = fixture
const mock = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const aliases = {
  'muse-speech-profile': new URL('../speech-profile.js', import.meta.url).href,
  'muse-speech-provider': new URL('../speech-provider.js', import.meta.url).href,
  preference: mock(
    `export default {get(namespace,key){const f=globalThis.__speechAccountFixture;f.reads.push([namespace,key]);return f.keys[key]}}`,
  ),
  'muse-cascaded-conversation': mock('export const createMuseCascadedConversation = options => options'),
  'stackchan-ai-http': mock(
    `export function createResponseTransport(...args){globalThis.__speechAccountFixture.transports.push(args);return Object.assign(()=>{}, {args})}`,
  ),
  'stackchan/voice/gemini-speech': mock(
    `export const GeminiTranscribeSTT={create:options=>({provider:'gemini',options})};export const GeminiSpeechTTS={create:options=>({open:playback=>({provider:'gemini',options,playback})})}`,
  ),
  'stackchan/voice/speech': mock(
    `export const WhisperSTT={create:options=>({provider:'openai',options})};export const OpenAISpeechTTS={create:options=>({open:playback=>({provider:'openai',options,playback})})}`,
  ),
  'stackchan/voice/cascaded': mock(
    'export const createCascadedConversation=()=>{}; export const createPushToTalk=()=>{}',
  ),
  'muse-chat-agent': mock('export const createMuseChatAgent=()=>{}'),
  'muse-chat-session': mock('export class MuseChatSession {}'),
  'muse-session-id': mock('export const museSessionId=()=>{}'),
}
for (const name of ['muse-account-native', 'rng', 'text/decoder', 'text/encoder', 'time', 'timer'])
  aliases[name] = mock('export default {}')
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier] ? { shortCircuit: true, url: aliases[specifier] } : next(specifier, context)
  },
})
const { createMuseAccountCascadedConversation } = await import('../cascaded-account-client.js')
hooks.deregister()
function reset(keys) {
  fixture.keys = keys
  fixture.reads = []
  fixture.transports = []
}

test('default account uses only OpenAI credentials and never creates a Google request', () => {
  reset({ token: 'fixture-openai', geminiToken: 'fixture-gemini' })
  const conversation = createMuseAccountCascadedConversation({})
  assert.equal(conversation.stt.provider, 'openai')
  assert.deepEqual(fixture.reads, [['ai', 'token']])
  assert.deepEqual(fixture.transports, [])
})

test('Gemini shares one dedicated credential across STT/TTS without an OpenAI bearer', async () => {
  reset({ token: 'fixture-openai', geminiToken: 'fixture-gemini' })
  const conversation = createMuseAccountCascadedConversation(
    {},
    { getSpeechProvider: () => 'gemini', getGeminiVoice: () => 'Leda' },
  )
  const synthesis = await conversation.tts.open({})
  assert.equal(conversation.stt.provider, 'gemini')
  assert.equal(synthesis.provider, 'gemini')
  assert.notEqual(synthesis.options.request, conversation.stt.options.request)
  assert.equal(synthesis.options.request.args[5], true)
  assert.equal(conversation.stt.options.request.args[5], undefined)
  assert.equal(synthesis.options.model, 'gemini-3.8-flash-tts')
  assert.deepEqual(fixture.reads, [['ai', 'geminiToken']])
  assert.deepEqual(fixture.transports, [
    [
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      '',
      45000,
      16384,
      { 'x-goog-api-key': 'fixture-gemini' },
    ],
    [
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      '',
      45000,
      16384,
      { 'x-goog-api-key': 'fixture-gemini' },
      true,
    ],
  ])
})

test('missing selected credential fails closed without fallback or transport', () => {
  reset({ token: 'fixture-openai' })
  assert.throws(() => createMuseAccountCascadedConversation({}, { getSpeechProvider: () => 'gemini' }), {
    code: 'gemini_key_missing',
  })
  assert.deepEqual(fixture.transports, [])
  assert.deepEqual(fixture.reads, [['ai', 'geminiToken']])
})
