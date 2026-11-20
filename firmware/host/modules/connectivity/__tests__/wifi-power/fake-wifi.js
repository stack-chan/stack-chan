import { equal } from 'testing/assert'
import { state } from 'wifi-power-save'
export default class WiFi {
  constructor() {
    state.initialized = true
  }
  connect() {
    equal(state.mode, state.expected, 'policy applies before connecting')
    state.connects++
  }
  disconnect() {}
  close() {
    state.closed++
  }
}
