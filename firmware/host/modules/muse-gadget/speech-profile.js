export const speechVoices = Object.freeze(['marin', 'coral', 'shimmer', 'nova'])
export const speechModel = 'gpt-4o-mini-tts'
export const speechInstructions =
  'Speak Japanese clearly in a naturally high-pitched, bright, cute and friendly voice. Keep the tone light and warm, with lively but gentle intonation and a natural conversational pace. Do not shout, whisper or sound strained. Read only the supplied text.'

export function createSpeechProfile({ read, write, voices = speechVoices } = {}) {
  let saved
  try {
    saved = read?.()
  } catch {}
  let voice = voices.includes(saved) ? saved : voices[0]
  return {
    current: () => voice,
    next() {
      const next = voices[(voices.indexOf(voice) + 1) % voices.length]
      write?.(next)
      voice = next
      return voice
    },
  }
}

export function createProfiledSpeech(createTTS, getVoice = () => speechVoices[0]) {
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    open(options) {
      const selected = getVoice()
      const voice = speechVoices.includes(selected) ? selected : speechVoices[0]
      return createTTS({ model: speechModel, instructions: speechInstructions }).open({ ...options, voice })
    },
  }
}
