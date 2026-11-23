import { createMuseAccountCascadedConversation } from 'muse-account-cascaded'
import { createConversationAccountOwner } from 'muse-setup/conversation-owner'
import { createDeviceAccountNetwork } from 'muse-setup/device-account-network'
import { createAudioRuntime } from 'stackchan/voice/device'
import { createConversationPipeline } from 'stackchan/voice/pipeline'
import { createVoiceScope } from 'stackchan/voice/scope'

export function createSetupConversationRuntime(
  onEvent,
  onProgress,
  onDiagnostic,
  {
    volume = 0.25,
    onPlaybackState,
    getSpeechVoice,
    getSpeechProvider,
    getGeminiVoice,
    nativeGeminiTransport = false,
    geminiSampleRate = 24000,
  } = {},
) {
  let owned = false,
    current,
    selectedProvider = 'openai'
  const audio = createAudioRuntime({
    volume,
    emitLevels: true,
    startupBlocks: () => (selectedProvider === 'gemini' ? 3 : 1),
    acquireExclusive() {
      if (owned) throw new Error('audio busy')
      owned = true
      return () => {
        owned = false
      }
    },
  })
  return {
    wrap(account, identity) {
      current = createConversationAccountOwner(account, {
        createConversation: (owner) => {
          const provider = getSpeechProvider?.() ?? 'openai'
          const conversation = createMuseAccountCascadedConversation(owner, {
            nodeId: identity.nodeId,
            onDiagnostic,
            onPlaybackState,
            getSpeechVoice,
            getSpeechProvider: () => provider,
            getGeminiVoice,
            nativeGeminiTransport,
            geminiSampleRate,
          })
          selectedProvider = provider
          return conversation
        },
        createPipeline: createConversationPipeline,
        createScope: createVoiceScope,
        microphone: audio.microphone,
        speaker: audio.speaker,
        network: createDeviceAccountNetwork(onProgress, onDiagnostic),
        onProgress,
        onDiagnostic,
        onEvent,
      })
      return current
    },
    mute(value) {
      if (!current) return Promise.reject(new Error('conversation unavailable'))
      return current.setMicrophoneMuted(value)
    },
    endCall() {
      return current?.endCall()
    },
  }
}
