import { state } from 'startup-error-ports'

export default {
  restart() {
    state.closeEvents.push('restart')
  },
}
