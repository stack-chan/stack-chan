export const geminiSpeechVoices = Object.freeze(['Leda', 'Zephyr', 'Laomedeia', 'Autonoe'])
export const geminiSpeechInstructions =
  'Speak Japanese like a cheerful, friendly virtual streamer: a naturally high, light and clear voice, cute lively intonation, soft sentence endings, and a slightly brisk conversational pace. Be expressive but easy to understand. Avoid shrill shouting, exaggerated breathiness, baby talk, or imitating any specific real person. Speak only the supplied dialogue.'

export function createSpeechProvider({ read, write, hasGeminiKey } = {}) {
  let saved
  try {
    saved = read?.()
  } catch {}
  let provider = saved === 'gemini' ? 'gemini' : 'openai'
  return {
    current: () => provider,
    next() {
      const next = provider === 'openai' ? 'gemini' : 'openai'
      if (next === 'gemini' && !hasGeminiKey?.())
        throw Object.assign(new Error('Gemini API key is not configured'), { code: 'gemini_key_missing' })
      write?.(next)
      provider = next
      return provider
    },
  }
}

export function createProfiledGeminiSpeech(createTTS, getVoice = () => geminiSpeechVoices[0]) {
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    open(options) {
      const selected = getVoice()
      const voice = geminiSpeechVoices.includes(selected) ? selected : geminiSpeechVoices[0]
      return createTTS({ model: 'gemini-3.8-flash-tts', instructions: geminiSpeechInstructions }).open({
        ...options,
        voice,
      })
    },
  }
}
