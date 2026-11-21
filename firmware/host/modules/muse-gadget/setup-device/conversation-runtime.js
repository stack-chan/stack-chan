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
  { volume = 0.25, onPlaybackState, getSpeechVoice, getSpeechProvider, getGeminiVoice } = {},
) {
  let owned = false,
    current
  const audio = createAudioRuntime({
    volume,
    emitLevels: true,
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
        createConversation: (owner) =>
          createMuseAccountCascadedConversation(owner, {
            nodeId: identity.nodeId,
            onDiagnostic,
            onPlaybackState,
            getSpeechVoice,
            getSpeechProvider,
            getGeminiVoice,
          }),
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
