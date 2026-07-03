export function hasValidChatType(chatConfig) {
  return typeof chatConfig?.type === 'string' && chatConfig.type.length > 0
}

function rootString(config, key) {
  const value = config?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function normalizeChatConfig(config) {
  const chatConfig = { ...(config?.chat ?? {}) }
  chatConfig.type ??= rootString(config, 'chatType')
  chatConfig.specifier ??= rootString(config, 'chatSpecifier')
  chatConfig.modelID ??= rootString(config, 'chatModelID')
  chatConfig.voiceID ??= rootString(config, 'chatVoiceID')
  chatConfig.instructions ??= rootString(config, 'chatInstructions')
  chatConfig.apiKey ??= rootString(config, 'chatApiKey')
  return chatConfig
}
