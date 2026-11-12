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
export const createCascadedConversation = (options) => {
  state.tts = options.tts
  return options
}
export const createVoiceScope = () => {
  const listeners = new Set()
  const signal = {
    aborted: false,
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }
  return {
    signal,
    abort() {
      signal.aborted = true
      for (const listener of [...listeners]) listener()
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
