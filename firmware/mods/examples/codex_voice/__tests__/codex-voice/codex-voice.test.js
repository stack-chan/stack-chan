import definition from 'mod'
import { equal } from 'testing/assert'

let toggle,
  gesture,
  stateListener,
  transportListener,
  attempts = 0
const requests = [],
  values = [],
  messages = []
const remote = {
  state: 'standby',
  transport: 'disconnected',
  requestStart() {
    requests.push('start')
    return 'start-1'
  },
  requestStop() {
    requests.push('stop')
    return 'stop-1'
  },
  onState(handler) {
    stateListener = handler
  },
  onTransport(handler) {
    transportListener = handler
  },
}
const app = {
  conversation: {
    remote() {
      if (++attempts === 1) throw Error('USB unavailable')
      return remote
    },
  },
  capabilities: {
    get() {
      return { availability: 'native' }
    },
  },
  input: {
    onMotion() {},
    onHeadTouch(handler) {
      gesture = handler
    },
  },
  ui: {
    addAction() {},
    addToggle(_options, handler) {
      toggle = handler
      return {
        setValue(value) {
          values.push(value)
        },
      }
    },
    showBalloon(text) {
      messages.push(text)
    },
  },
}
await definition.setup(app)
equal(attempts, 1, 'setup attempts to activate the approval workflow')
toggle(true)
equal(attempts, 2, 'user action retries a failed activation')
equal(requests.join(','), 'start', 'activation succeeds before issuing a start request')
equal(values.at(-1), false, 'request acceptance keeps the observed standby state')
remote.state = 'listening'
stateListener('listening')
equal(values.at(-1), true, 'observed state changes update the toggle')
gesture({ gesture: 'backwardSwipe' })
gesture({ gesture: 'forwardSwipe' })
equal(requests.join(','), 'start,stop,start', 'head swipes retain start and stop semantics')
transportListener('unsupported')
equal(messages.at(-1), 'USB: unsupported', 'unsupported transport remains visible')
trace('ok\n')
