import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativeSpeechTransport, geminiEndpoint } from '../gemini-native-transport.js'

const body = {
  length: 2,
  *read() {
    yield Uint8Array.of(1, 2)
  },
}
function fixture(sequence = [0], options = {}) {
  const controller = new AbortController()
  let closed = 0,
    reads = 0,
    created = 0,
    clock = 0,
    input
  class Reader {
    constructor(endpoint, key, bytes) {
      created++
      assert.equal(endpoint, geminiEndpoint)
      assert.equal(key, 'fixture_key_0123456789')
      input = bytes
      assert.deepEqual([...bytes], [1, 2])
    }
    read(buffer) {
      reads++
      const next = sequence.shift()
      if (Array.isArray(next)) {
        buffer.set(next)
        return next.length
      }
      return next
    }
    close() {
      closed++
    }
  }
  const request = createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', 1000, {
    Reader,
    now: () => clock,
    async pause(ms) {
      clock += ms
      await options.pause?.(ms, controller)
    },
  })
  return {
    request,
    controller,
    closed: () => closed,
    reads: () => reads,
    created: () => created,
    input: () => input,
    advance: (ms) => (clock += ms),
  }
}

test('native transport rejects endpoint and credential ambiguity before any allocation', () => {
  for (const endpoint of [
    'http://generativelanguage.googleapis.com/v1beta/interactions',
    `${geminiEndpoint}?key=x`,
    `${geminiEndpoint}/`,
    'https://generativelanguage.googleapis.com.evil/v1beta/interactions',
  ])
    assert.throws(() => createNativeSpeechTransport(endpoint, 'fixture_key_0123456789', 1000, {}), TypeError)
  for (const key of ['', 'x\r\nHost: evil', 'x'.repeat(513), 'x\0y'])
    assert.throws(() => createNativeSpeechTransport(geminiEndpoint, key, 1000, {}), TypeError)
  for (const timeout of [0, 999, 120001, NaN])
    assert.throws(() => createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', timeout, {}), RangeError)
})
test('pending and partial reads preserve bytes and close once, wiping request scratch', async () => {
  const f = fixture([-2, [10], [20, 30], 0]),
    got = []
  await f.request(body, async (bytes) => got.push(...bytes), { signal: f.controller.signal })
  assert.deepEqual(got, [10, 20, 30])
  assert.equal(f.closed(), 1)
  assert.deepEqual([...f.input()], [0, 0])
})
test('no subsequent native read before consumer accepts borrowed buffer', async () => {
  const f = fixture([[10], [20], 0])
  let release
  const run = f.request(
    body,
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
    { signal: f.controller.signal },
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads(), 1)
  f.controller.abort(Object.assign(Error(), { code: 'cancelled' }))
  release()
  await assert.rejects(run, { code: 'cancelled' })
  assert.equal(f.reads(), 1)
  assert.ok(f.closed() >= 1)
})
test('cancel while pending releases native task and suppresses further reads', async () => {
  const f = fixture([-2, [1]], {
    pause: (_ms, controller) => controller.abort(Object.assign(Error(), { code: 'cancelled' })),
  })
  await assert.rejects(
    f.request(body, () => assert.fail(), { signal: f.controller.signal }),
    { code: 'cancelled' },
  )
  assert.equal(f.reads(), 1)
})
test('pre-cancelled request never constructs native reader', async () => {
  const f = fixture()
  f.controller.abort(Object.assign(Error(), { code: 'cancelled' }))
  await assert.rejects(
    f.request(body, () => {}, { signal: f.controller.signal }),
    { code: 'cancelled' },
  )
  assert.equal(f.created(), 0)
})
for (const [value, code] of [
  [-1, 'provider_failed'],
  [-3, 'deadline_exceeded'],
  [-4, 'resource_exhausted'],
  [4097, 'provider_failed'],
]) {
  test(`native result ${value} is sanitized and releases resources`, async () => {
    const f = fixture([value])
    await assert.rejects(
      f.request(body, () => {}, { signal: f.controller.signal }),
      { code },
    )
    assert.equal(f.closed(), 1)
  })
}
test('overall deadline includes pending periods and consumer backpressure', async () => {
  const f = fixture([[1], [2], 0])
  await assert.rejects(
    f.request(body, () => f.advance(1000), { signal: f.controller.signal }),
    { code: 'deadline_exceeded' },
  )
  assert.equal(f.reads(), 1)
  assert.equal(f.closed(), 1)
})
test('consumer failure closes native task without another read', async () => {
  const f = fixture([[1], [2], 0])
  await assert.rejects(
    f.request(
      body,
      () => {
        throw Error('consumer')
      },
      { signal: f.controller.signal },
    ),
    /consumer/,
  )
  assert.equal(f.reads(), 1)
  assert.equal(f.closed(), 1)
})
test('malformed body length fails before network construction', async () => {
  for (const invalid of [
    { length: 32769 },
    {
      length: 1,
      *read() {
        yield Uint8Array.of(1, 2)
      },
    },
    {
      length: 2,
      *read() {
        yield Uint8Array.of(1)
      },
    },
  ]) {
    const f = fixture()
    await assert.rejects(f.request(invalid, () => {}, { signal: f.controller.signal }))
    assert.equal(f.created(), 0)
  }
})

test('native key validation accepts all provisioned visible ASCII, including dotted credentials', () => {
  for (const key of ['fixture.dotted.key.0123456789', 'x'.repeat(512), '0123456789!@#$%^&*()_', 'x'.repeat(20)])
    assert.doesNotThrow(() => createNativeSpeechTransport(geminiEndpoint, key, 1000, {}))
  for (const key of ['x'.repeat(19), 'x'.repeat(513), '01234567890123456789 ', '01234567890123456789\r', '01234567890123456789\n', '01234567890123456789\x7f', '01234567890123456789ﾃｩ'])
    assert.throws(() => createNativeSpeechTransport(geminiEndpoint, key, 1000, {}), TypeError)
})

test('native diagnostics expose only fixed numeric stage and constructor categories', async () => {
  for (const message of ['Speech native unavailable (5)', 'key=private', 'Speech native unavailable (5) secret']) {
    const records = []
    const request = createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', 1000, {
      Reader: class { constructor() { throw Error(message) } }, now: () => 0, pause: async () => {},
      onDiagnostic: value => records.push(value),
    })
    await assert.rejects(request(body, () => {}, { signal: new AbortController().signal }), { code: 'provider_failed' })
    assert.deepEqual(records, [[7, 0, message === 'Speech native unavailable (5)' ? 5 : 0, 0, 0, 0, 0, 0, 0, 0]])
  }
})
test('native status snapshot is validated before diagnostic delivery', async () => {
  for (const value of [7005000, 'secret', 7999999, -1, Infinity]) {
    const records = []
    const request = createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', 1000, {
      Reader: class { read() { return -1 } diagnostic() { return value } close() {} },
      now: () => 0, pause: async () => {}, onDiagnostic: row => records.push(row),
    })
    await assert.rejects(request(body, () => {}, { signal: new AbortController().signal }))
    assert.equal(records.length, value === 7005000 ? 1 : 0)
  }
})

test('transport detail encodes only bounded open and errno categories, before cleanup', async () => {
  for (const detail of [0, 101, 201, 607, -1, 8, 108, 700, 'secret', Infinity]) {
    const records = [], phases = []
    const request = createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', 1000, {
      Reader: class {
        read() { return -1 }
        diagnostic() { return 4010000 }
        transportDiagnostic() { phases.push('snapshot'); return detail }
        close() { phases.push('close') }
      },
      now: () => 0, pause: async () => {}, onDiagnostic: row => records.push(row),
    })
    await assert.rejects(request(body, () => {}, { signal: new AbortController().signal }), { code: 'provider_failed' })
    assert.deepEqual(phases, ['snapshot', 'close'])
    const valid = [0, 101, 201, 607].includes(detail)
    assert.deepEqual(records, valid ? [[7, 4010000, 0, detail, 0, 0, 0, 0, 0, 0]] : [])
  }
})
test('extended transport failure reasons accept only defined categories', async () => {
  for (const reason of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
    const records = []
    const value = 4000000 + reason * 1000
    const request = createNativeSpeechTransport(geminiEndpoint, 'fixture_key_0123456789', 1000, {
      Reader: class { read() { return -1 } diagnostic() { return value } close() {} },
      now: () => 0, pause: async () => {}, onDiagnostic: row => records.push(row),
    })
    await assert.rejects(request(body, () => {}, { signal: new AbortController().signal }))
    assert.deepEqual(records, reason <= 17 ? [[7, value, 0, 0, 0, 0, 0, 0, 0, 0]] : [])
  }
})
