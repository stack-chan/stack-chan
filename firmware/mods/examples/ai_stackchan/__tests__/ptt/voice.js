export const state = { presses: 0, releases: 0, starts: 0, closes: 0 }
export const createPushToTalk = () => ({
  detector: {},
  press() {
    state.presses++
  },
  release() {
    state.releases++
    state.onRelease?.()
  },
})
export const createCascadedConversation = (options) => options
export const createVoiceScope = () => {
  const signal = { aborted: false }
  return {
    signal,
    abort() {
      signal.aborted = true
    },
  }
}
export const createConversationPipeline = (options) => {
  state.pipeline = options
  return {
    setVolume() {},
    async start() {
      state.starts++
    },
    async close() {
      state.closes++
      await state.onClose?.()
    },
  }
}
