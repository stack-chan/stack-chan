import definition from 'mod'
import { equal } from 'testing/assert'

let select,
  receive,
  closes = 0,
  opened
const balloons = []
const peer = {
  onMessage(type, handler) {
    equal(type, 'text')
    receive = handler
  },
  async close() {
    closes++
    receive = undefined
  },
}
const app = {
  network: {
    async openPeer(options) {
      opened = options
      return peer
    },
  },
  ui: {
    addAction() {},
    addChoice(_options, handler) {
      select = handler
    },
    showBalloon(text) {
      balloons.push(text)
    },
    hideBalloon() {},
  },
}
await definition.setup(app)
equal(opened, undefined, 'radio stays stopped until selected')
await select('receiver')
equal(opened.displayName, 'stackchan-receiver', 'published receiver name is retained')
receive({ payload: { text: 'hello\nworld 7\u202e' } })
equal(balloons.at(-1), 'hello world 7', 'received text is sanitized')
const count = balloons.length
receive({ payload: { text: 8 } })
equal(balloons.length, count, 'invalid payload does not change the balloon')
await select('stopped')
equal(closes, 1, 'role exit closes the SDK connection')
trace('ok\n')
