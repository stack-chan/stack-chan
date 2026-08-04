export function hasValidChatType(chatConfig) {
  return typeof chatConfig?.type === 'string' && chatConfig.type.length > 0
}

export function normalizeChatConfig(config) {
  return { ...(config?.chat ?? {}) }
}

export function withChatDefaults(chatConfig, defaultInstructions) {
  return {
    ...chatConfig,
    voiceID: chatConfig.voiceID ?? 'marin',
    instructions: chatConfig.instructions ?? defaultInstructions,
  }
}
