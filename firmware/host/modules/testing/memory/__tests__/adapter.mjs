import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { LiveSession as BaseSession } from '../../../../../mods/examples/openai_live_webrtc/session.js'
import { MemoryRecorder } from '../recorder.js'

const logs = [],
  timers = new Map()
let next = 0,
  ready,
  connected,
  started = false
const network = new Promise((resolve) => {
    ready = resolve
  }),
  connection = new Promise((resolve) => {
    connected = resolve
  })
const context = createContext({ trace: (line) => logs.push(JSON.parse(line.slice('[stackchan-memory] '.length))) })
function module(exports) {
  return new SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    },
    { context },
  )
}
const dependencies = {
  'memory-diagnostics': module({ default: () => ({ atUs: 10, durationUs: 1, internal: {}, psram: {} }) }),
  'memory-recorder': module({ MemoryRecorder }),
  'openai-live-session-base': module({ LiveSession: BaseSession }),
  timer: module({
    default: {
      set(callback, delay) {
        timers.set(++next, { callback, delay })
        return next
      },
      clear(id) {
        timers.delete(id)
      },
    },
  }),
}
const source = new URL('../../../../../mods/examples/openai_live_webrtc/memory-session.js', import.meta.url)
const adapter = new SourceTextModule(readFileSync(source, 'utf8'), { context })
await adapter.link((name) => {
  assert.ok(dependencies[name], name)
  return dependencies[name]
})
await adapter.evaluate()
const session = new adapter.namespace.LiveSession({
  Conversation: class {
    setVolume() {}
    connect() {
      started = true
      return connection
    }
    close() {
      return Promise.resolve({ finalized: true })
    }
  },
  audio: { acquireExclusive: () => () => {} },
  acquireLowLatency: () => ({ close() {} }),
  amp: {},
  networkReady: network,
  settings: { apiKey: 'test-placeholder' },
  onState() {},
})
assert.equal(logs.at(-1).phase, 'idle-before-use')
const starting = session.start()
assert.equal(logs.at(-1).phase, 'before-connect')
assert.equal(started, false)
assert.equal(timers.size, 0)
ready({ status: 'connected' })
await Promise.resolve()
assert.equal(started, true)
assert.equal(logs.at(-1).phase, 'negotiating')
assert.equal([...timers.values()][0].delay, 250)
connected()
await starting
assert.equal(logs.at(-1).phase, 'connected')
assert.equal(timers.size, 1)
assert.equal([...timers.values()][0].delay, 5000)
await session.stop()
assert.equal(logs.at(-1).phase, 'after-close')
assert.equal(logs.at(-1).state, 'idle')
assert.equal(timers.size, 1)
assert.equal([...timers.values()][0].delay, 1000)
