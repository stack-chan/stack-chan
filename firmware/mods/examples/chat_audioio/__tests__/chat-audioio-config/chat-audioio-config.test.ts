import { hasValidChatType, normalizeChatConfig } from 'chat-audioio-config'
import { equal } from 'testing/assert'

trace('=== chat-audioio-config test ===\n')

equal(hasValidChatType({ type: { invalid: true } }), false, 'non-string chat type should disable chat')

equal(hasValidChatType({ type: '' }), false, 'empty chat type should disable chat')

equal(hasValidChatType({ type: 'openAIRealtime' }), true, 'non-empty chat type should enable chat')

const nestedConfig = normalizeChatConfig({
  chat: {
    type: 'openAIRealtime',
    modelID: 'gpt-realtime-mini',
    voiceID: 'marin',
    apiKey: 'test-api-key',
  },
})
equal(nestedConfig.type, 'openAIRealtime', 'nested chat type should map to chat config type')
equal(nestedConfig.modelID, 'gpt-realtime-mini', 'nested chat modelID should map to chat config modelID')
equal(nestedConfig.voiceID, 'marin', 'nested chat voiceID should map to chat config voiceID')
equal(nestedConfig.apiKey, 'test-api-key', 'nested chat apiKey should map to chat config apiKey')

const rootConfig = normalizeChatConfig({
  chatType: 'openAIRealtime',
  chatApiKey: 'root-key',
})
equal(rootConfig.type, undefined, 'root chatType should not enable chat')
equal(rootConfig.apiKey, undefined, 'root chatApiKey should not map to chat config apiKey')

trace('ok\n')
