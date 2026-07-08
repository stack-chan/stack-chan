export function hasValidChatType(chatConfig) {
  return typeof chatConfig?.type === 'string' && chatConfig.type.length > 0
}

export function normalizeChatConfig(config) {
  return { ...(config?.chat ?? {}) }
}
