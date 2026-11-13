export const state = { writes: [], finishes: 0, closes: 0 }
class Synthesis {
  output = {}
  async write(text) {
    state.writes.push(text)
    this.text = text
  }
  async endInput() {
    state.finishes++
    await state.onFinish?.()
  }
  async flush() {
    await state.onFinish?.()
  }
  async close() {
    state.closes++
    await state.onClose?.()
  }
}
const createOpenAISpeechTTS = () => ({
  capabilities: { input: 'segmented', output: 'streaming' },
  async open() {
    return new Synthesis()
  },
})
const createWhisperSTT = () => ({})

export const OpenAISpeechTTS = { create: createOpenAISpeechTTS }
export const WhisperSTT = { create: createWhisperSTT }
