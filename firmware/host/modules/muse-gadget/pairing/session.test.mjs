import assert from 'node:assert/strict'
import test from 'node:test'
import { createReceiver, frameRecord } from './framing.js'
import { createPairingSession } from './session.js'

const encoder = new TextEncoder(),
  decoder = new TextDecoder()
const data = (action) => encoder.encode(JSON.stringify({ action })).buffer

test('official framing roundtrips across MTU and rejects sequence/overflow', () => {
  for (const mtu of [23, 100, 247, 517]) {
    const bytes = encoder.encode('日本語'.repeat(100)),
      rx = createReceiver()
    let result
    for (const frame of frameRecord(bytes, mtu)) {
      assert.equal(frame[0], 0xfe)
      assert.ok(frame.length <= Math.min(mtu - 3, 160))
      result = rx.push(frame)
    }
    assert.deepEqual(result, bytes)
  }
  const rx = createReceiver()
  assert.throws(() => rx.push(new Uint8Array([254, 1, 2, 1])))
  rx.push(new Uint8Array([254, 0, 2, 1]))
  assert.throws(() => rx.push(new Uint8Array([254, 0, 0])))
  assert.throws(() => rx.push(new Uint8Array(8193)))
  assert.throws(() => [...frameRecord(new Uint8Array(8192), 23)])
})

function fixture(overrides = {}, diagnostics = [], startScan = () => ({ promise: Promise.resolve([]), close() {} })) {
  let generation = 1,
    live = true,
    armed = false,
    provision = false,
    scan = false,
    hold
  const events = [],
    frames = [],
    staged = []
  const native = {
    generation() {
      return generation
    },
    hello() {
      events.push('hello')
      return '{"type":"pairing_server_hello"}'
    },
    info() {
      return '{"type":"device_info"}'
    },
    scanResult(_generation, json) {
      events.push('scanResult')
      return { json: JSON.stringify({ type: 'wifi_scan_result', networks: JSON.parse(json) }), recordGeneration: 1 }
    },
    receive() {
      if (scan) return { kind: 'wifi_scan', generation }
      return provision
        ? { kind: 'provision', generation, provisionReady: true }
        : { kind: 'finished', generation, confirmationRequired: true }
    },
    status(name) {
      events.push(name)
      return { json: JSON.stringify({ status: name }), recordGeneration: 1 }
    },
    recordCurrent() {
      return live
    },
    current(g) {
      return live && g === generation
    },
    arm() {
      events.push('arm')
      armed = true
      return live
    },
    confirm() {
      assert.ok(armed)
      events.push('physical')
      return ++generation
    },
    reset() {
      live = false
      events.push('reset')
    },
    close() {
      events.push('close')
    },
  }
  Object.assign(native, overrides)
  const session = createPairingSession({
    startScan,
    onDiagnostic: (value) => diagnostics.push(value),
    native,
    encode: (s) => encoder.encode(s),
    decode: (b) => decoder.decode(b),
    delay: async () => {
      events.push('delay')
      if (hold) await hold
    },
    transport: {
      notify: async (b) => {
        frames.push(new Uint8Array(b))
        events.push('notify')
      },
      disconnect: async () => events.push('disconnect'),
    },
    onConfirmation: () => events.push('prompt'),
    onState: (s) => events.push(s),
    onProvision: (x) => staged.push(x),
  })
  return {
    session,
    events,
    frames,
    staged,
    setScan(value) {
      scan = value
    },
    setProvision() {
      provision = true
    },
    expire() {
      live = false
    },
    setHold(p) {
      hold = p
    },
  }
}

test('finished notification completes before arm; physical confirmation then opaque provision gate', async () => {
  const f = fixture()
  assert.equal(await f.session.confirmPhysical(), false)
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  assert.ok(f.events.indexOf('arm') > f.events.lastIndexOf('notify'))
  assert.equal(await f.session.confirmPhysical(), true)
  assert.ok(f.events.indexOf('physical') < f.events.indexOf('pairing_confirmed'))
  f.setProvision()
  await f.session.receive(data('pairing_encrypted'))
  assert.deepEqual(f.staged, [{ generation: 2, provisionReady: true }])
  assert.ok(!f.events.includes('disconnect'))
  f.session.close()
  assert.ok(f.events.includes('reset'))
})

test('plaintext credential commands fail closed without reaching native or UI', async () => {
  for (const action of ['provision_v2', 'set_wifi', 'set_auth', 'ota', 'unpair']) {
    const f = fixture()
    await f.session.receive(data(action))
    assert.ok(f.events.includes('disconnect'))
    assert.equal(f.staged.length, 0)
    assert.ok(!f.events.includes('hello'))
  }
})

test('disconnect during encrypted prompt prevents stale physical arming', async () => {
  const f = fixture()
  await f.session.receive(data('pairing_client_hello'))
  let release
  f.setHold(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const work = f.session.receive(data('pairing_encrypted'))
  await Promise.resolve()
  await Promise.resolve()
  f.session.disconnect()
  release()
  await work
  assert.ok(!f.events.includes('arm'))
  assert.equal(await f.session.confirmPhysical(), false)
})

test('expiry clears native staging and disconnects', async () => {
  const f = fixture()
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  f.expire()
  f.session.poll()
  await Promise.resolve()
  assert.ok(f.events.includes('disconnect'))
  assert.equal(await f.session.confirmPhysical(), false)
})

test('old operation completion cannot clear new session busy ownership', async () => {
  let releaseOld, releaseNew
  const f = fixture()
  f.setHold(
    new Promise((resolve) => {
      releaseOld = resolve
    }),
  )
  const old = f.session.receive(data('pairing_client_hello'))
  await Promise.resolve()
  await Promise.resolve()
  f.session.disconnect()
  f.setHold(
    new Promise((resolve) => {
      releaseNew = resolve
    }),
  )
  const newer = f.session.receive(data('pairing_client_hello'))
  await Promise.resolve()
  await Promise.resolve()
  releaseOld()
  await old
  await f.session.receive(data('get_device_info'))
  assert.ok(f.events.includes('disconnect'), 'new operation must still own busy flag')
  releaseNew()
  await newer
})

test('close always closes native even if reset or UI throws', () => {
  let closed = false
  const session = createPairingSession({
    native: {
      reset() {
        throw new Error('reset')
      },
      close() {
        closed = true
      },
    },
    transport: {},
    encode() {},
    decode() {},
    delay() {},
    onState() {
      throw new Error('UI')
    },
  })
  assert.throws(() => session.close())
  assert.equal(closed, true)
})

test('notification rejection resets session and never arms confirmation', async () => {
  const events = []
  const native = {
    receive: () => ({ kind: 'finished', generation: 1, confirmationRequired: true }),
    status: () => ({ json: '{}', recordGeneration: 1 }),
    recordCurrent: () => true,
    arm() {
      events.push('arm')
      return true
    },
    reset() {
      events.push('reset')
    },
  }
  const session = createPairingSession({
    native,
    encode: (s) => encoder.encode(s),
    decode: (b) => decoder.decode(b),
    delay: async () => {},
    transport: {
      notify() {
        throw new Error('notification rejected')
      },
      disconnect() {
        events.push('disconnect')
      },
    },
  })
  await session.receive(data('pairing_encrypted'))
  assert.deepEqual(events, ['reset', 'disconnect'])
  assert.equal(await session.confirmPhysical(), false)
})

test('poll and receive absorb native teardown failure without unhandled rejection', async () => {
  let closed = 0,
    disconnected = 0
  const native = {
    reset() {
      throw new Error('reset')
    },
    close() {
      ++closed
    },
    hello() {
      return '{}'
    },
    generation() {
      return 1
    },
    current() {
      throw new Error('expired')
    },
  }
  const session = createPairingSession({
    native,
    encode: (s) => encoder.encode(s),
    decode: (b) => decoder.decode(b),
    delay: async () => {},
    transport: {
      notify() {},
      disconnect() {
        ++disconnected
        throw new Error('link gone')
      },
    },
  })
  await session.receive(data('pairing_client_hello'))
  assert.doesNotThrow(() => session.poll())
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(closed, 1)
  assert.equal(disconnected, 1)
})

test('new connection resets negotiated MTU to the ATT default', async () => {
  const f = fixture()
  f.session.setMTU(247)
  await f.session.receive(data('pairing_client_hello'))
  f.session.disconnect()
  f.frames.length = 0
  await f.session.receive(data('pairing_client_hello'))
  assert.ok(f.frames.length > 1)
  assert.ok(f.frames.every((frame) => frame.length <= 20))
})

test('completed zero-result scan returns an encrypted empty result without staging or reset', async () => {
  const f = fixture()
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  await f.session.confirmPhysical()
  f.frames.length = 0
  f.setScan(true)
  await f.session.receive(data('pairing_encrypted'))
  const rx = createReceiver()
  let record
  for (const frame of f.frames) record = rx.push(frame.buffer) ?? record
  assert.deepEqual(JSON.parse(decoder.decode(record)), { type: 'wifi_scan_result', networks: [] })
  assert.equal(f.staged.length, 0)
  assert.ok(!f.events.includes('reset'))
})
test('progress requires provision and FIFO prevents frame interleaving', async () => {
  const f = fixture()
  assert.equal(await f.session.reportProgress('auth_ok'), false)
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  await f.session.confirmPhysical()
  assert.equal(await f.session.reportProgress('auth_ok'), false)
  f.setProvision()
  await f.session.receive(data('pairing_encrypted'))
  f.frames.length = 0
  assert.deepEqual(
    await Promise.all([f.session.reportProgress('wifi_connecting'), f.session.reportProgress('wifi_connected')]),
    [true, true],
  )
  const rx = createReceiver(),
    messages = []
  for (const frame of f.frames) {
    const b = rx.push(frame.buffer)
    if (b) messages.push(JSON.parse(decoder.decode(b)).status)
  }
  assert.deepEqual(messages, ['wifi_connecting', 'wifi_connected'])
  assert.equal(await f.session.reportProgress('arbitrary'), false)
})

test('record transmission has no busy delay after its final notification', async () => {
  const f = fixture()
  await f.session.receive(data('pairing_client_hello'))
  assert.equal(f.events.filter((e) => e === 'delay').length, f.frames.length - 1)
  f.session.setMTU(247)
  const before = f.events.filter((e) => e === 'delay').length
  await f.session.receive(data('pairing_encrypted'))
  assert.equal(f.events.filter((e) => e === 'delay').length, before)
  assert.ok(!f.events.includes('disconnect'))
})

test('pairing diagnosis exposes fixed stages only, never native error content', async () => {
  for (const [message, reason] of [
    ['pairing finished decrypt rejected', 'native_decrypt'],
    ['pairing decrypt aead', 'decrypt_aead'],
    ['pairing decrypt counter', 'decrypt_counter'],
    ['pairing finished command rejected', 'native_command'],
    ['private fixture payload must not appear', undefined],
  ]) {
    const diagnostics = []
    const f = fixture(
      {
        receive() {
          throw new Error(message)
        },
      },
      diagnostics,
    )
    await f.session.receive(data('pairing_encrypted'))
    assert.deepEqual(diagnostics, ['encrypted_received', ...(reason ? [reason] : []), 'failed_decrypt'])
    assert.ok(f.events.includes('disconnect'))
    assert.ok(!JSON.stringify(diagnostics).includes(message))
  }
})

test('pairing diagnosis distinguishes status generation from physical arming failure', async () => {
  for (const [overrides, stage] of [
    [
      {
        status() {
          throw new Error('private fixture')
        },
      },
      'failed_status_create',
    ],
    [
      {
        arm() {
          return false
        },
      },
      'failed_arm',
    ],
  ]) {
    const diagnostics = []
    const f = fixture(overrides, diagnostics)
    await f.session.receive(data('pairing_encrypted'))
    assert.equal(diagnostics.at(-1), stage)
    assert.ok(f.events.includes('disconnect'))
    assert.ok(!f.events.includes('prompt'))
  }
})

test('confirmed scan encrypts actual results and disconnect cancels stale scan work', async () => {
  let finish,
    closed = 0
  const f = fixture({}, [], () => ({
    promise: new Promise((resolve) => {
      finish = resolve
    }),
    close() {
      closed++
    },
  }))
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  await f.session.confirmPhysical()
  f.setScan(true)
  const work = f.session.receive(data('pairing_encrypted'))
  f.session.disconnect()
  finish([{ ssid: 'fixture', rssi: -42, secure: true }])
  await work
  assert.ok(closed >= 1)
  assert.equal(f.events.includes('scanResult'), false)
})

test('scan failure does not masquerade as an empty successful scan', async () => {
  const f = fixture({}, [], () => ({ promise: Promise.reject(new Error('scan_failed')), close() {} }))
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  await f.session.confirmPhysical()
  f.setScan(true)
  await f.session.receive(data('pairing_encrypted'))
  assert.equal(f.events.includes('scanResult'), false)
  assert.ok(f.events.includes('disconnect'))
})

test('scan requires physical confirmation and returns real networks only after completion', async () => {
  let scans = 0
  const networks = [{ ssid: 'fixture', rssi: -40, secure: true }]
  const f = fixture({}, [], () => {
    scans++
    return { promise: Promise.resolve(networks), close() {} }
  })
  await f.session.receive(data('pairing_client_hello'))
  await f.session.receive(data('pairing_encrypted'))
  await f.session.confirmPhysical()
  f.frames.length = 0
  f.setScan(true)
  await f.session.receive(data('pairing_encrypted'))
  const rx = createReceiver()
  let record
  for (const frame of f.frames) record = rx.push(frame.buffer) ?? record
  assert.deepEqual(JSON.parse(decoder.decode(record)), { type: 'wifi_scan_result', networks })
  assert.equal(scans, 1)
  const g = fixture({}, [], () => {
    scans++
    throw new Error('unexpected')
  })
  await g.session.receive(data('pairing_client_hello'))
  g.setScan(true)
  await g.session.receive(data('pairing_encrypted'))
  assert.equal(scans, 1)
})
