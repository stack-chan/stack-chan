import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('setup snapshots provider per conversation and keeps reserve runtime-local', async () => {
  let runtimeOptions, conversationOptions
  const context = vm.createContext({})
  const modules = {
    'muse-account-cascaded': {
      createMuseAccountCascadedConversation(_owner, options) {
        conversationOptions = options
        return {}
      },
    },
    'muse-setup/conversation-owner': {
      createConversationAccountOwner(owner, options) {
        options.createConversation(owner)
        return {}
      },
    },
    'muse-setup/device-account-network': {
      createDeviceAccountNetwork() {
        return {}
      },
    },
    'stackchan/voice/device': {
      createAudioRuntime(options) {
        runtimeOptions = options
        return { microphone: {}, speaker: {} }
      },
    },
    'stackchan/voice/pipeline': { createConversationPipeline() {} },
    'stackchan/voice/scope': { createVoiceScope() {} },
  }
  const module = new vm.SourceTextModule(
    await readFile(new URL('./conversation-runtime.js', import.meta.url), 'utf8'),
    { context },
  )
  await module.link((specifier) => {
    const exports = modules[specifier]
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
      },
      { context },
    )
  })
  await module.evaluate()
  const onPlaybackState = () => {},
    onDiagnostic = () => {}
  let selected = 'gemini'
  const getSpeechVoice = () => 'coral',
    getSpeechProvider = () => selected,
    getGeminiVoice = () => 'Leda'
  const runtime = module.namespace.createSetupConversationRuntime(
    () => {},
    () => {},
    onDiagnostic,
    { onPlaybackState, getSpeechVoice, getSpeechProvider, getGeminiVoice, nativeGeminiTransport: true },
  )
  runtime.wrap({}, { nodeId: 'fixture-node' })
  assert.equal(conversationOptions.nativeGeminiTransport, true)
  assert.equal(runtimeOptions.emitLevels, true)
  assert.equal(runtimeOptions.volume, 0.25)
  assert.equal(conversationOptions.getSpeechVoice, getSpeechVoice)
  assert.equal(conversationOptions.getSpeechProvider(), 'gemini')
  assert.equal(runtimeOptions.startupBlocks(), 3)
  selected = 'openai'
  assert.equal(conversationOptions.getSpeechProvider(), 'gemini')
  assert.equal(runtimeOptions.startupBlocks(), 3)
  runtime.wrap({}, { nodeId: 'fixture-node' })
  assert.equal(conversationOptions.getSpeechProvider(), 'openai')
  assert.equal(runtimeOptions.startupBlocks(), 1)
  assert.equal(conversationOptions.getGeminiVoice, getGeminiVoice)
  assert.equal(conversationOptions.nodeId, 'fixture-node')
  assert.equal(conversationOptions.onDiagnostic, onDiagnostic)
  assert.equal(conversationOptions.onPlaybackState, onPlaybackState)
  const prior = runtimeOptions
  module.namespace.createSetupConversationRuntime()
  assert.equal(runtimeOptions.startupBlocks(), 1)
  selected = 'gemini'
  runtime.wrap({}, { nodeId: 'fixture-node' })
  assert.equal(prior.startupBlocks(), 3)
  assert.equal(runtimeOptions.startupBlocks(), 1)
})
