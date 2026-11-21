import MuseAccountNative from 'muse-account-native'
import { createMuseVoiceConversationWithNative } from 'muse-voice'

export function createMuseAccountVoiceConversation(account, { nodeId, appId = 'hatch-web', onDiagnostic } = {}) {
  if (!account || typeof nodeId !== 'string' || !nodeId.length) throw new Error('Muse account configuration required')
  return createMuseVoiceConversationWithNative(
    { nodeId },
    (_options, callback) => new MuseAccountNative(account, callback, appId),
    onDiagnostic,
  )
}
