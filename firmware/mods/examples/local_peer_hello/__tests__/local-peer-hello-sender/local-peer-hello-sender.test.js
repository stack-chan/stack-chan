import definition from 'mod'
import { equal } from 'testing/assert'

let select,
  tick,
  closes = 0,
  cancelled = 0,
  found = false,
  sent
const peer = {
  async discover(options) {
    equal(options.timeoutMs, 1000)
    return found ? [{ id: 'receiver', name: 'stackchan-receiver' }] : []
  },
  async send(id, type, payload) {
    sent = { id, type, payload }
  },
  async close() {
    closes++
  },
}
const app = {
  network: {
    async openPeer(options) {
      equal(options.displayName, 'stackchan-sender')
      return peer
    },
  },
  time: {
    every(ms, handler) {
      equal(ms, 3000)
      tick = handler
      return () => {
        cancelled++
      }
    },
  },
  ui: {
    addAction() {},
    addChoice(_options, handler) {
      select = handler
    },
    showBalloon() {},
    hideBalloon() {},
  },
}
await definition.setup(app)
await select('sender')
await tick({})
equal(sent, undefined, 'discovery without receiver does not send')
found = true
await tick({})
equal(sent.id, 'receiver', 'sender chooses the receiver role')
equal(sent.type, 'text', 'wire message type is retained')
equal(sent.payload.text, 'こんにちは 1', 'first sequence is included')
await tick({})
equal(sent.payload.text, 'こんにちは 2', 'sequence advances after a send')
await select('stopped')
equal(cancelled, 1, 'stopping cancels the periodic operation')
equal(closes, 1, 'stopping closes the connection')
trace('ok\n')
