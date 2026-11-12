export const state = { writes: [], flushes: 0, finishes: 0, closes: 0 }
class Synthesis {
  output = {}
  async write(text) {
    state.writes.push(text)
    this.text = text
  }
  async flush() {
    state.flushes++
    await state.onFlush?.()
  }
  async finish() {
    state.finishes++
    await state.onFinish?.()
  }
  textAt() {
    return { text: this.text, basis: 'completed-segment' }
  }
  async close() {
    state.closes++
    await state.onClose?.()
  }
}
export const createOpenAISpeechTTS = () => ({
  async open() {
    return new Synthesis()
  },
})
export const createWhisperSTT = () => ({})
