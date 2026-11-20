import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

async function harness({ supported = true, failConfigure = false } = {}) {
  const readers = [],
    timers = new Map(),
    buttons = new Map(),
    messages = []
  let nextTimer = 0
  class Reader {
    samples = []
    sampleCalls = 0
    writes = []
    reads = 0
    antenna = []
    closeCalls = 0
    constructor() {
      readers.push(this)
    }
    configure({ antenna }) {
      this.antenna.push(antenna)
      if (antenna && failConfigure) throw new Error('field failed')
    }
    sample() {
      this.sampleCalls++
      const result = this.samples.shift()
      if (result instanceof Error) throw result
      return result
    }
    readNDEF() {
      this.reads++
      if (this.readError) throw this.readError
      return this.ndef
    }
    writeNDEF(options) {
      this.writes.push(options)
      if (this.writeError) throw this.writeError
      assert.equal(Array.isArray(options), false, 'SDK writeNDEF takes an options object')
      assert.equal(typeof options.uri, 'string')
      return uriNDEF(options.uri)
    }
    close() {
      this.closeCalls++
    }
  }
  const timer = {
    repeat(callback, interval) {
      const id = nextTimer++ // includes zero: clearing must not test truthiness
      timers.set(id, { callback, interval })
      return id
    },
    clear(id) {
      assert.equal(timers.delete(id), true, 'clear an active timer exactly once')
    },
  }
  const context = vm.createContext({ device: { sensor: supported ? { RFID: Reader } : {} }, trace() {} })
  const module = new vm.SourceTextModule(await readFile(new URL('./mod.js', import.meta.url), 'utf8'), { context })
  await module.link((specifier) => {
    assert.equal(specifier, 'timer')
    return new vm.SyntheticModule(
      ['default'],
      function () {
        this.setExport('default', timer)
      },
      { context },
    )
  })
  await module.evaluate()
  const robot = {
    ui: {
      showBalloon: (message) => messages.push(message),
      drawer: {
        addDrawerButton(button) {
          assert.equal(buttons.has(button.key), false, 'no duplicate drawer registrations')
          buttons.set(button.key, button)
        },
        removeDrawerButton: (key) => buttons.delete(key),
      },
    },
  }
  const launch = () => module.namespace.onContextCreated(robot)
  launch()
  return {
    readers,
    timers,
    buttons,
    messages,
    launch,
    select: (value) => buttons.get('rfidPolling').callback(robot, value),
    read: () => buttons.get('rfidRead').callback(robot),
    write: () => buttons.get('rfidWrite').callback(robot),
    tick: () => {
      for (const entry of timers.values()) entry.callback()
    },
  }
}

const type2 = { present: true, uidHex: '04aabbccddeeff', sak: 0, type: 'MIFARE Ultralight' }
const TEST_URI = 'https://stack-chan.com/'
// SDK 10.0.1 wrapNdef() returns { records, text }; URI belongs to a U record.
const uriNDEF = (uri) => ({ records: [{ tnf: 1, type: 'U', uri }], text: uri })

test('RFID remains uninstantiated until selected; unsupported hosts get no controls', async () => {
  const h = await harness()
  assert.equal(h.readers.length, 0)
  assert.equal(h.timers.size, 0)
  h.read()
  h.write()
  assert.equal(h.readers.length, 0)
  const unsupported = await harness({ supported: false })
  assert.equal(unsupported.buttons.size, 0)
  assert.match(unsupported.messages.at(-1), /required/)
})

test('poll edges display UID and removal; stopping prevents all RF IO and restart redetects', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  assert.equal([...h.timers.values()][0].interval, 250)
  reader.samples.push(type2, undefined, { present: false })
  h.tick()
  assert.match(h.messages.at(-1), /04aabbccddeeff/)
  const count = h.messages.length
  h.tick()
  assert.equal(h.messages.length, count, 'unchanged card is not repeated')
  h.tick()
  assert.match(h.messages.at(-1), /removed/)
  h.select('off')
  assert.equal(h.timers.size, 0)
  assert.deepEqual(reader.antenna, [true, false])
  assert.equal(reader.closeCalls, 1)
  h.tick()
  h.read()
  h.write()
  assert.equal(reader.sampleCalls, 3)
  assert.equal(reader.reads, 0)
  assert.equal(reader.writes.length, 0)
  h.select('1000')
  assert.equal([...h.timers.values()][0].interval, 1000)
  assert.equal(h.readers.length, 2)
  h.readers[1].samples.push(type2)
  h.tick()
  assert.match(h.messages.at(-1), /04aabbccddeeff/)
})

test('NDEF write is explicit and checked by a separate read; poll never writes', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  reader.ndef = uriNDEF(TEST_URI)
  h.tick()
  assert.equal(reader.writes.length, 0)
  assert.equal(reader.reads, 0)
  h.read()
  assert.equal(reader.reads, 1)
  assert.equal(h.messages.at(-1), TEST_URI)
  h.write()
  assert.equal(reader.writes.length, 1)
  assert.equal(reader.writes[0].uri, TEST_URI)
  assert.equal(reader.reads, 2)
  assert.match(h.messages.at(-1), /write\/read-back OK/)
})

test('read-back finds a URI record after a text record instead of using summary text', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  reader.ndef = uriNDEF(TEST_URI)
  reader.ndef.records.unshift({ tnf: 1, type: 'T', language: 'en', text: 'A tag' })
  reader.ndef.text = 'A tag'
  h.read()
  assert.equal(h.messages.at(-1), TEST_URI)
  h.write()
  assert.match(h.messages.at(-1), /write\/read-back OK/)
})

test('URI mismatch is rejected even when writeNDEF returns the expected URI', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  reader.ndef = uriNDEF('https://wrong.example/')
  h.write()
  assert.equal(reader.writes.length, 1)
  assert.equal(reader.reads, 1)
  assert.match(h.messages.at(-1), /read-back mismatch/)
  assert.equal(h.messages.includes('NDEF: write/read-back OK'), false)
})

test('text containing the expected URI cannot substitute for a URI record', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  reader.ndef = { records: [{ tnf: 1, type: 'T', language: 'en', text: TEST_URI }], text: TEST_URI }
  h.write()
  assert.match(h.messages.at(-1), /read-back mismatch/)
})

test('failed or unavailable read-back never reports a successful write', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  reader.readError = new Error('read failed')
  h.write()
  assert.equal(reader.writes.length, 1)
  assert.equal(reader.reads, 1)
  assert.match(h.messages.at(-1), /NDEF failed: Error: read failed/)
  reader.readError = undefined
  h.write()
  assert.equal(reader.writes.length, 2)
  assert.equal(reader.reads, 2)
  assert.match(h.messages.at(-1), /read-back mismatch/)
  assert.equal(h.messages.includes('NDEF: write/read-back OK'), false)
})

test('refresh rejects a removed card or Classic before NDEF IO', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  h.tick()
  reader.samples.push({ present: false })
  h.write()
  assert.match(h.messages.at(-1), /no card/)
  reader.samples.push({ ...type2, sak: 8 })
  h.read()
  h.write()
  assert.match(h.messages.at(-1), /Type 2 only/)
  assert.equal(reader.writes.length, 0)
  assert.equal(reader.reads, 0)
})

test('IO errors and empty NDEF are reported without escaping the callback', async () => {
  const h = await harness()
  h.select('250')
  const reader = h.readers[0]
  reader.samples.push(type2)
  h.read()
  assert.match(h.messages.at(-1), /empty or unavailable/)
  reader.writeError = new Error('locked tag')
  h.write()
  assert.match(h.messages.at(-1), /locked tag/)
  assert.equal(reader.reads, 1, 'failed write is not reported as verified')
  reader.samples.push(new Error('I2C failed'))
  h.write()
  assert.match(h.messages.at(-1), /no card/)
  assert.equal(reader.writes.length, 1, 'sample failure invalidates cached card')
})

test('changing period and repeated context creation close old reader and clear timer', async () => {
  const h = await harness()
  h.select('250')
  h.select('1000')
  assert.equal(h.readers[0].closeCalls, 1)
  assert.equal(h.timers.size, 1)
  h.launch()
  assert.equal(h.readers[1].closeCalls, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.buttons.size, 3)
  assert.equal(h.buttons.get('rfidPolling').value, 'off')
  h.select('bad')
  assert.equal(h.readers.length, 2)
})

test('startup failure shuts down a partially initialized reader', async () => {
  const h = await harness({ failConfigure: true })
  h.select('250')
  assert.equal(h.readers[0].closeCalls, 1)
  assert.deepEqual(h.readers[0].antenna, [true, false])
  assert.equal(h.timers.size, 0)
  assert.match(h.messages.at(-1), /start failed/)
})
