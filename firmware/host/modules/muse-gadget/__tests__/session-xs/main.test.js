import { MuseSession } from 'muse-session'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Timer from 'timer'

const encoder = new TextEncoder(),
  decoder = new TextDecoder()
let callback,
  closes = 0,
  states = 0
const session = new MuseSession(
  { host: 'example.invalid', vmId: 'test', nodeId: 'test', token: 'fixture-only' },
  {
    open(_options, emit) {
      callback = emit
      return {
        close() {
          closes++
        },
        start() {},
      }
    },
    setTimer: (fn, ms) => Timer.set(fn, ms),
    clearTimer: (id) => Timer.clear(id),
    encode: (value) => encoder.encode(value).buffer,
    decode: (value) => decoder.decode(value),
    onState() {
      states++
    },
  },
)
session.connect()
callback(1)
if (session.state !== 'noise-handshake') throw new Error('handshake state')
const old = callback
session.close()
const stoppedStates = states
Timer.set(() => {
  old(3)
  if (states !== stoppedStates || closes !== 1) throw new Error('late callback after close')
  session.connect()
  old(3)
  if (session.state !== 'connecting') throw new Error('stale reconnect event')
  session.close()
  if (closes !== 2) throw new Error('reconnect close')
  trace('@@STACKCHAN_TEST:PASS@@\n')
}, 10)
