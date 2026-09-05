import assert from 'node:assert/strict'
import test from 'node:test'
import { ServoBusRegistry, type ServoCommand, type ServoEndpoint } from '../internal/servo-bus.js'
import { ServoDriverResources } from '../internal/servo-driver-resources.js'

class Clock {
  now = 0
  next = 0
  jobs = new Map<number, { at: number; callback: () => void }>()
  set = (callback: () => void, ms: number): number => {
    const id = ++this.next
    this.jobs.set(id, { at: this.now + ms, callback })
    return id
  }
  clear = (id: unknown): void => {
    this.jobs.delete(id as number)
  }
  advance(ms = 0): void {
    const until = this.now + ms
    let budget = 10_000
    while (true) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > until) break
      assert.ok(--budget > 0, 'timer processing must remain bounded')
      this.now = next[1].at
      this.jobs.delete(next[0])
      next[1].callback()
    }
    this.now = until
  }
}

function fixture() {
  const clock = new Clock()
  const callbackErrors: unknown[] = []
  const registry = new ServoBusRegistry(clock, (error) => callbackErrors.push(error))
  const config = { port: 2, receive: 16, transmit: 17, baud: 1_000_000, protocol: 'fixture' }
  const transports: {
    format: string
    writes: Uint8Array[]
    closes: number
    receive: (id: number, payload: Uint8Array) => void
    onWrite?: (packet: Uint8Array) => void
    closeError?: Error
  }[] = []
  const create = (receive: (id: number, payload: Uint8Array) => void) => {
    const state: (typeof transports)[number] = { format: 'number', writes: [], closes: 0, receive }
    transports.push(state)
    return Object.assign(state, {
      write(packet: Uint8Array) {
        state.writes.push(packet.slice())
        state.onWrite?.(packet)
      },
      close() {
        state.closes++
        if (state.closeError) throw state.closeError
      },
    })
  }
  const acquire = (id: number) => registry.acquire(config, id, 252, create)
  const outcomes: { label: string; error?: unknown; payload?: Uint8Array }[] = []
  const command = (label: string, timeoutMs = 100): ServoCommand => ({
    timeoutMs,
    encode: (id) => new Uint8Array([id, 42]),
    onResult: (payload) => outcomes.push({ label, payload }),
    onError: (error) => outcomes.push({ label, error }),
  })
  return { clock, registry, config, transports, create, acquire, outcomes, command, callbackErrors }
}

test('100 two-axis lifetimes share one UART, serialize replies, and return timers and owners to baseline', () => {
  const f = fixture()
  for (let cycle = 0; cycle < 100; cycle++) {
    const pan = f.acquire(1)
    const tilt = f.acquire(2)
    const serial = f.transports[cycle]
    assert.equal(f.transports.length, cycle + 1)
    pan.send(f.command('pan'))
    tilt.send(f.command('tilt'))
    f.clock.advance()
    assert.deepEqual(
      serial.writes.map((packet) => packet[0]),
      [1],
    )
    serial.receive(2, new Uint8Array([99]))
    assert.equal(f.outcomes.length, cycle * 2, 'a different ID cannot complete the active request')
    serial.receive(1, new Uint8Array([10]))
    assert.equal(f.outcomes.length, cycle * 2, 'completion is outside the transport callback')
    f.clock.advance()
    assert.deepEqual(
      serial.writes.map((packet) => packet[0]),
      [1, 2],
    )
    serial.receive(2, new Uint8Array([20]))
    f.clock.advance()
    pan.close()
    pan.close()
    assert.equal(serial.closes, 0)
    tilt.close()
    tilt.close()
    assert.equal(serial.closes, 1)
    assert.equal(f.clock.jobs.size, 0)
  }
  assert.equal(f.outcomes.length, 200)
  assert.ok(f.outcomes.every((outcome) => !outcome.error))
})

test('UART config, protocol and ID conflicts are rejected before another transport is opened', () => {
  const f = fixture()
  assert.throws(() => f.acquire(Number.NaN), { code: 'INVALID_ARGUMENT' })
  assert.equal(f.transports.length, 0)
  const owner = f.acquire(1)
  assert.throws(() => f.acquire(1), { code: 'BUSY' })
  for (const change of [{ baud: 115_200 }, { transmit: 9 }, { receive: 8 }, { protocol: 'other' }]) {
    assert.throws(() => f.registry.acquire({ ...f.config, ...change }, 2, 252, f.create), { code: 'CONFIG' })
  }
  assert.throws(() => f.registry.assertUnused(2), { code: 'BUSY' })
  assert.equal(f.transports.length, 1)
  owner.close()
  f.registry.assertUnused(2)
  assert.throws(
    () =>
      f.registry.acquire(f.config, 1, 252, () => {
        throw new Error('open')
      }),
    /open/,
  )
  f.acquire(1).close()
})

test('waiting capacity and deadlines reject work without writing it or faulting the active command', () => {
  const f = fixture()
  const owner = f.acquire(1)
  owner.send(f.command('active', 60_000))
  f.clock.advance()
  for (let i = 0; i < 8; i++) assert.equal(owner.send(f.command(`waiting ${i}`)), true)
  assert.equal(owner.send(f.command('overflow')), false)
  assert.equal((f.outcomes[0].error as { code: string }).code, 'BUSY')
  f.clock.advance(5_000)
  assert.equal(f.outcomes.length, 9)
  assert.equal(f.transports[0].writes.length, 1)
  f.transports[0].receive(1, new Uint8Array())
  f.clock.advance()
  assert.equal(f.outcomes[9].label, 'active')
  assert.equal(f.outcomes[9].error, undefined)
  owner.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('a wire timeout faults all waiting work and old transport callbacks cannot complete a reopened bus', () => {
  const f = fixture()
  const pan = f.acquire(1)
  const tilt = f.acquire(2)
  pan.send(f.command('active', 10))
  tilt.send(f.command('waiting'))
  f.clock.advance(10)
  assert.equal(f.outcomes.length, 2)
  assert.ok(f.outcomes.every((item) => (item.error as { code: string }).code === 'TIMEOUT'))
  f.transports[0].receive(1, new Uint8Array([1]))
  assert.equal(tilt.send(f.command('after timeout')), false)
  assert.equal(f.clock.jobs.size, 0)
  pan.close()
  tilt.close()
  const next = f.acquire(1)
  next.send(f.command('new lifetime'))
  f.clock.advance()
  f.transports[0].receive(1, new Uint8Array([1]))
  f.clock.advance()
  assert.equal(f.outcomes.length, 3)
  f.transports[1].receive(1, new Uint8Array([2]))
  f.clock.advance()
  assert.equal(f.outcomes.length, 4)
  assert.deepEqual(f.outcomes[3].payload, new Uint8Array([2]))
  next.close()
})

test('closing a queued endpoint leaves the active endpoint usable', () => {
  const f = fixture()
  const pan = f.acquire(1)
  const tilt = f.acquire(2)
  pan.send(f.command('active'))
  f.clock.advance()
  tilt.send(f.command('queued'))
  tilt.close()
  f.transports[0].receive(1, new Uint8Array())
  f.clock.advance()
  assert.equal(f.outcomes.length, 2)
  assert.equal(f.outcomes[0].label, 'queued')
  assert.equal((f.outcomes[0].error as { code: string }).code, 'CLOSED')
  assert.equal(f.outcomes[1].error, undefined)
  pan.close()
})

test('closing an active endpoint cancels the bus once even when callbacks reenter close', () => {
  const f = fixture()
  const pan = f.acquire(1)
  const tilt = f.acquire(2)
  let callbacks = 0
  const command = () => ({
    ...f.command('close'),
    onError: () => {
      callbacks++
      pan.close()
      tilt.close()
    },
  })
  pan.send(command())
  f.clock.advance()
  tilt.send(command())
  pan.close()
  f.clock.advance(1_000)
  assert.equal(callbacks, 2)
  assert.equal(f.transports[0].closes, 1)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.callbackErrors.length, 0)
})

test('synchronous replies are captured, client exceptions do not deliver twice, and admission-only writes are deferred', () => {
  const f = fixture()
  const owner = f.acquire(1)
  const serial = f.transports[0]
  serial.onWrite = (packet) => serial.receive(packet[0], new Uint8Array([3]))
  let results = 0
  let errors = 0
  owner.send({
    ...f.command('sync'),
    onResult: () => {
      results++
      throw new Error('client')
    },
    onError: () => errors++,
  })
  assert.equal(results, 0)
  f.clock.advance()
  assert.equal(results, 1)
  assert.equal(errors, 0)
  assert.equal(f.callbackErrors.length, 1)
  owner.send({ ...f.command('no reply'), waitForResponse: false })
  f.clock.advance()
  assert.equal(f.outcomes.length, 0)
  f.clock.advance(5)
  assert.equal(f.outcomes.length, 1)
  owner.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('write failures restore format and stop reuse; a failed physical close keeps its UART reserved', () => {
  const f = fixture()
  const owner = f.acquire(1)
  const serial = f.transports[0]
  serial.onWrite = () => {
    throw new Error('write failed')
  }
  owner.send(f.command('write'))
  owner.send(f.command('queued'))
  f.clock.advance()
  assert.equal(f.outcomes.length, 2)
  assert.equal(serial.format, 'number')
  assert.equal(serial.writes.length, 1)
  serial.closeError = new Error('close failed')
  assert.throws(() => owner.close(), /close failed/)
  owner.close()
  assert.equal(serial.closes, 1)
  assert.throws(() => f.acquire(1))
  assert.equal(f.transports.length, 1)
  assert.equal(f.clock.jobs.size, 0)
})

test('ID changes reserve both aliases, exclude concurrent commands, and release all aliases at close', () => {
  const f = fixture()
  const owner = f.acquire(1)
  const change = owner.beginIdChange(5)
  assert.throws(() => f.acquire(5), { code: 'BUSY' })
  assert.equal(owner.send(f.command('external')), false)
  change.send({
    ...f.command('change'),
    onResult: () => {
      change.commit()
      change.close()
    },
  })
  f.clock.advance()
  assert.throws(() => owner.beginIdChange(6), { code: 'BUSY' })
  f.transports[0].receive(5, new Uint8Array())
  f.clock.advance()
  assert.equal(owner.id, 5)
  const oldIdOwner = f.acquire(1)
  const interrupted = owner.beginIdChange(6)
  interrupted.send(f.command('interrupted'))
  owner.close()
  interrupted.close()
  const replacement: ServoEndpoint[] = [f.acquire(5), f.acquire(6)]
  for (const endpoint of replacement) endpoint.close()
  oldIdOwner.close()
  assert.equal(f.transports[0].closes, 1)
  assert.equal(f.clock.jobs.size, 0)
})

test('driver rollback closes every acquired device in reverse order and preserves the original failure', () => {
  const scope = new ServoDriverResources()
  const released: number[] = []
  scope.own({ close: () => released.push(1) })
  scope.own({
    close: () => {
      released.push(2)
      throw new Error('cleanup')
    },
  })
  const original = new Error('constructor')
  assert.throws(
    () => scope.rollback(original),
    (error) => error === original,
  )
  scope.close()
  assert.deepEqual(released, [2, 1])
})

test('timer allocation failure does not transmit work or leak a UART lease', () => {
  const f = fixture()
  const owner = f.acquire(1)
  f.clock.set = () => {
    throw new Error('timer allocation failed')
  }
  assert.equal(owner.send(f.command('rejected')), false)
  assert.equal(f.outcomes.length, 1)
  assert.ok(f.outcomes[0].error instanceof Error)
  assert.equal(f.transports[0].writes.length, 0)
  owner.close()
  assert.equal(f.transports[0].closes, 1)
})

test('closing a no-response write before its transmission delay expires cannot start another transaction', () => {
  const f = fixture()
  const first = f.acquire(1)
  const second = f.acquire(2)
  first.send({ ...f.command('transmitting'), waitForResponse: false })
  f.clock.advance()
  second.send(f.command('waiting'))
  first.close()
  f.clock.advance(200)
  assert.equal(f.transports[0].writes.length, 1)
  assert.equal(f.outcomes.length, 2)
  assert.ok(f.outcomes.every((item) => item.error instanceof Error))
  second.close()
  assert.equal(f.clock.jobs.size, 0)
})
