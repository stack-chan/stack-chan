import { assert } from 'testing/assert'
export const state = { initialized: false, connects: 0, mode: 'none', expected: 'none', closed: 0, fail: false }
export default {
  setMode(mode) {
    assert(state.initialized, 'policy must follow Wi-Fi initialization')
    state.mode = mode
  },
  getMode() {
    if (state.fail) throw new Error('power driver unavailable')
    return state.mode
  },
}
