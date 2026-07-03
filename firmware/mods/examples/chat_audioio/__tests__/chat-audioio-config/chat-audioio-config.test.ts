import { hasValidChatType, normalizeChatConfig } from 'chat-audioio-config'
import { equal } from 'testing/assert'

trace('=== chat-audioio-config test ===\n')

equal(hasValidChatType({ type: { invalid: true } }), false, 'non-string chat type should disable chat')

equal(hasValidChatType({ type: '' }), false, 'empty chat type should disable chat')

equal(hasValidChatType({ type: 'openAIRealtime' }), true, 'non-empty chat type should enable chat')

const rootConfig = normalizeChatConfig({
  chatType: 'openAIRealtime',
  chatModelID: 'gpt-realtime-mini',
  chatVoiceID: 'marin',
  chatApiKey: 'test-api-key',
})
equal(rootConfig.type, 'openAIRealtime', 'root chatType should map to chat config type')
equal(rootConfig.modelID, 'gpt-realtime-mini', 'root chatModelID should map to chat config modelID')
equal(rootConfig.voiceID, 'marin', 'root chatVoiceID should map to chat config voiceID')
equal(rootConfig.apiKey, 'test-api-key', 'root chatApiKey should map to chat config apiKey')

const nestedConfig = normalizeChatConfig({
  chat: { type: 'nested', apiKey: 'nested-key' },
  chatType: 'root',
  chatApiKey: 'root-key',
})
equal(nestedConfig.type, 'nested', 'nested chat type should take precedence')
equal(nestedConfig.apiKey, 'nested-key', 'nested chat apiKey should take precedence')

trace('ok\n')
