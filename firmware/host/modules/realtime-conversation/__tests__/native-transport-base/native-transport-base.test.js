import { createTransport } from 'realtimeConversation/transport-core'
import { assert, equal } from 'testing/assert'

class NativeBase extends Native('xs_native_transport_test_destructor') {
  constructor() {
    super()
    native('xs_native_transport_test_open').call(this)
  }
}
const readNativeState = native('xs_native_transport_test_read')
const events = []
let poll,
  released = 0
const Timer = {
  repeat(callback) {
    poll = callback
    return {}
  },
  schedule() {},
  clear() {},
}
const bindings = {
  xs_live_transport_constructor() {
    equal(readNativeState.call(this), 123, 'native base initialized')
  },
  xs_live_transport_start() {
    equal(readNativeState.call(this), 123, 'native receiver preserved')
  },
  xs_live_transport_close() {
    events.push({ type: 'released' })
  },
  xs_live_transport_read() {
    return events.shift()
  },
  xs_live_transport_stats() {
    return { samples: readNativeState.call(this) }
  },
  xs_live_transport_release() {
    released++
  },
}
const Transport = createTransport({ Timer, Base: NativeBase, native: (name) => bindings[name], ArrayBuffer })
const transport = new Transport(() => {})
assert(transport instanceof NativeBase, 'portable wrapper retains its native base')
transport.start()
transport
  .close()
  .then(() => {
    equal(transport.stats.samples, 123, 'final native state is retained after close')
    equal(released, 1, 'native release runs once')
    trace('@@STACKCHAN_TEST:PASS@@\n')
  })
  .catch((error) => {
    trace(`${String(error)}\n`)
    trace('@@STACKCHAN_TEST:FAIL@@\n')
  })
poll()
