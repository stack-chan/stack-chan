import { hasValidChatType, normalizeChatConfig, withChatDefaults } from 'chat-audioio-config'
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

const providerDefaults = withChatDefaults({ type: 'deepgramAgent' }, 'default instructions')
equal(providerDefaults.specifier, undefined, 'provider defaults should not override the configured chat type')
equal(providerDefaults.voiceID, 'marin', 'provider defaults should supply the default voice')
equal(providerDefaults.instructions, 'default instructions', 'provider defaults should supply default instructions')

const explicitWorker = withChatDefaults(
  {
    type: 'openAIRealtime',
    specifier: 'stackchanOpenAIRealtime',
    voiceID: 'cedar',
    instructions: 'custom instructions',
  },
  'default instructions',
)
equal(explicitWorker.specifier, 'stackchanOpenAIRealtime', 'an explicit worker override should be preserved')
equal(explicitWorker.voiceID, 'cedar', 'an explicit voice should be preserved')
equal(explicitWorker.instructions, 'custom instructions', 'explicit instructions should be preserved')

trace('ok\n')
