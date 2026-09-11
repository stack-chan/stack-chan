import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NetworkConnectionState as State } from '../modules/connectivity/network-state.js'
import type { NetworkConnection, StartNetworkConnectionOptions } from '../modules/connectivity/network-types.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { BootSessionDependencies, HostBootServicesOptions } from './boot-session.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const name of ['cancellation', 'task-scope', 'owned-resources'])
    writeAliasPackage(hostRoot, name, resolve(hostRoot, `app/${name}.js`))
  writeAliasPackage(hostRoot, 'network-state', resolve(hostRoot, 'modules/connectivity/network-state.js'))
  writeAliasPackage(hostRoot, 'local-peer-types', resolve(hostRoot, 'modules/connectivity/local-peer-types.js'))
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  for (const directory of [hostRoot, resolve(hostRoot, 'modules')]) {
    writeAliasPackageSubpath(directory, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
    writeAliasPackageSubpath(directory, 'stackchan', 'settings-schema', resolve(hostRoot, '../sdk/settings-schema.js'))
  }
  return import('./boot-session.js')
}
async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}
class Clock {
  now = 0
  jobs = new Set<{ due: number; callback(): void }>()
  after(ms: number, callback: () => void) {
    const job = { due: this.now + ms, callback }
    this.jobs.add(job)
    return () => {
      this.jobs.delete(job)
    }
  }
  advance(ms: number) {
    this.now += ms
    for (const job of [...this.jobs]) if (job.due <= this.now && this.jobs.delete(job)) job.callback()
  }
}
class Connection implements NetworkConnection {
  closed = false
  state: NetworkConnection['state'] = State.CONNECTING
  closes = 0
  failure?: Error
  close() {
    if (!this.closed) {
      this.closes++
      this.closed = true
      this.state = State.CLOSED
    }
    if (this.failure) throw this.failure
  }
}
function fixture() {
  const clock = new Clock()
  const attempts: { options: StartNetworkConnectionOptions; connection: Connection }[] = []
  let peerCloses = 0
  const dependencies: BootSessionDependencies = {
    clock,
    networkAvailability: 'native',
    createLocalPeer: () => ({
      id: '001122334455',
      async open() {
        throw new Error('unused')
      },
      close() {
        peerCloses++
      },
    }),
    openNetwork(options) {
      const connection = new Connection()
      attempts.push({ options, connection })
      return connection
    },
  }
  return { clock, attempts, dependencies, peerCloses: () => peerCloses }
}
const options: HostBootServicesOptions = {
  credentials: { ssid: 'robot-ap', password: 'password' },
  wifi: { maxAttempts: 1, attemptTimeoutMs: 20, retryDelayMs: 5 },
}

test('boot owns its successful connection and peer until idempotent host close', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  const boot = new BootSession(options, f.dependencies)
  await flush()
  const attempt = f.attempts[0]
  assert.equal(attempt.options.scanBeforeConnect, true)
  assert.equal(boot.connectivity.network.availability, 'native')
  assert.equal(boot.connectivity.network.state, State.CONNECTING)
  attempt.connection.state = State.CONNECTED
  attempt.options.onConnected()
  assert.deepEqual(await boot.connectivity.network.ready, { status: 'connected' })
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(attempt.connection.closes, 0)
  const closing = boot.close()
  assert.equal(boot.close(), closing)
  await closing
  assert.equal(attempt.connection.closes, 1)
  assert.equal(f.peerCloses(), 1)
  assert.equal(boot.connectivity.network.state, State.CLOSED)
})

test('100 cancelled starts drain leases, timers, peers, and ignore late completion', async () => {
  const { BootSession } = await setup()
  for (let i = 0; i < 100; i++) {
    const f = fixture()
    const boot = new BootSession(options, f.dependencies)
    if (i % 2) await flush()
    await boot.close()
    const result = await boot.connectivity.network.ready
    assert.equal(result.status, 'failed')
    assert.equal(result.status === 'failed' && result.code, 'CLOSED')
    for (const attempt of f.attempts) {
      attempt.options.onConnected()
      attempt.options.onError('late error')
      attempt.options.onStateChanged(State.CONNECTED)
      assert.equal(attempt.connection.closes, 1)
    }
    f.clock.advance(1000)
    await flush()
    assert.equal(f.attempts.length, i % 2)
    assert.equal(f.peerCloses(), 1)
    assert.equal(f.clock.jobs.size, 0)
    assert.equal(boot.connectivity.network.state, State.CLOSED)
  }
})

test('attempt timeout releases the lease; cancel during retry starts no further connection', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  const boot = new BootSession({ ...options, wifi: { ...options.wifi, maxAttempts: 3 } }, f.dependencies)
  await flush()
  f.clock.advance(20)
  await flush()
  assert.equal(f.attempts[0].connection.closes, 1)
  assert.equal(f.clock.jobs.size, 1, 'only retry delay remains')
  await boot.close()
  f.clock.advance(1000)
  await flush()
  assert.equal(f.attempts.length, 1)
  assert.equal(f.clock.jobs.size, 0)
  const result = await boot.connectivity.network.ready
  assert.equal(result.status === 'failed' && result.code, 'CLOSED')
})

test('automatic retries are bounded and each failed attempt is released before the next', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  const boot = new BootSession({ ...options, wifi: { ...options.wifi, maxAttempts: 3 } }, f.dependencies)
  for (let i = 0; i < 3; i++) {
    await flush()
    assert.equal(f.attempts.length, i + 1)
    f.clock.advance(20)
    await flush()
    assert.equal(f.attempts[i].connection.closed, true)
    f.clock.advance(5)
  }
  assert.deepEqual(await boot.connectivity.network.ready, {
    status: 'failed',
    code: 'TIMEOUT',
    reason: 'connection timeout',
  })
  assert.equal(f.clock.jobs.size, 0)
  await boot.close()
})

test('replacement waits for previous cleanup and propagates cleanup failure', async () => {
  const { BootSession } = await setup()
  for (const fail of [false, true]) {
    const f = fixture()
    let finish: () => void
    let reject: (error: unknown) => void
    f.dependencies.beforeStart = () =>
      new Promise<void>((resolve, rejectPromise) => {
        finish = resolve
        reject = rejectPromise
      })
    const boot = new BootSession(options, f.dependencies)
    await flush()
    assert.equal(f.attempts.length, 0)
    if (fail) reject(new Error('old radio failed to stop'))
    else finish()
    await flush()
    assert.equal(f.attempts.length, fail ? 0 : 1)
    if (fail) assert.equal((await boot.connectivity.network.ready).status, 'failed')
    await boot.close()
  }
})

test('failed attempt cleanup remains observable from close and still releases the peer', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  const boot = new BootSession(options, f.dependencies)
  await flush()
  f.attempts[0].connection.failure = new Error('radio did not stop')
  f.attempts[0].options.onError('connection failed')
  const result = await boot.connectivity.network.ready
  assert.equal(result.status === 'failed' && result.code, 'IO')
  await assert.rejects(boot.close(), /radio did not stop/)
  assert.equal(f.attempts[0].connection.closes, 1)
  assert.equal(f.peerCloses(), 1)
})

test('borrowed local peer waits for replacement cleanup and a cancelled open settles immediately', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  let release: () => void
  let opens = 0
  f.dependencies.beforeStart = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  f.dependencies.createLocalPeer = () => ({
    id: '001122334455',
    async open() {
      opens++
      throw new Error('not reached')
    },
    close() {},
  })
  const boot = new BootSession(options, f.dependencies)
  const opening = boot.connectivity.localPeer.open({ service: 'robot' })
  await flush()
  assert.equal(opens, 0)
  await boot.close()
  await assert.rejects(opening, { code: 'CLOSED' })
  release()
  await flush()
  assert.equal(opens, 0)
  assert.equal(f.attempts.length, 0)
})

test('closing an unstarted replacement still tears down the preceding boot', async () => {
  const { BootSession } = await setup()
  const f = fixture()
  let priorCloses = 0
  f.dependencies.beforeStart = async () => {
    priorCloses++
  }
  const boot = new BootSession(options, f.dependencies)
  await boot.close()
  await flush()
  assert.equal(priorCloses, 1)
  assert.equal(f.attempts.length, 0)
})

test('unavailable targets, invalid limits, and missing credentials allocate no network adapter', async () => {
  const { BootSession } = await setup()
  for (const [availability, ssid] of [
    ['unavailable', 'robot-ap'],
    ['native', ''],
  ] as const) {
    const f = fixture()
    f.dependencies.networkAvailability = availability
    const boot = new BootSession({ credentials: { ssid, password: '' } }, f.dependencies)
    assert.equal((await boot.connectivity.network.ready).status, 'skipped')
    assert.equal(f.attempts.length, 0)
    await boot.close()
  }
  for (const wifi of [{ maxAttempts: 0 }, { maxAttempts: 1.5 }, { attemptTimeoutMs: NaN }, { retryDelayMs: -1 }]) {
    const f = fixture()
    assert.throws(() => new BootSession({ ...options, wifi }, f.dependencies), { code: 'INVALID_ARGUMENT' })
    assert.equal(f.attempts.length, 0)
  }
})

test('boot consumes the same resolved settings snapshot: saved, nested profile, and ignored root credentials', async () => {
  const { BootSession } = await setup()
  const { SettingsService } = await import('../modules/preferences/settings-service.js')
  const cases = [
    { profile: { ssid: 'setup-ap', password: 'secret' }, saved: {}, expected: '' },
    {
      profile: { wifi: { ssid: 'profile-ap', password: 'profile-secret' }, chat: { type: 'openAIRealtime' } },
      saved: {},
      expected: 'profile-ap',
    },
    {
      profile: { wifi: { ssid: 'profile-ap', password: 'profile-secret' } },
      saved: { 'wifi.ssid': 'saved-ap', 'wifi.password': 'saved-secret' },
      expected: 'saved-ap',
    },
  ]
  for (const { profile, saved, expected } of cases) {
    const settings = new SettingsService({
      profile: () => profile,
      app: () => ({ wifi: { ssid: 'mod-ap', password: 'mod-secret' } }),
      storage: {
        get: (domain, key) => saved[`${domain}.${key}`],
        set() {},
        delete() {},
      },
    })
    const credentials = { ssid: settings.get('wifi.ssid') ?? '', password: settings.get('wifi.password') ?? '' }
    const f = fixture()
    const boot = new BootSession({ credentials }, f.dependencies)
    credentials.ssid = 'mutation-after-start'
    await flush()
    if (expected) {
      assert.equal(f.attempts[0].options.ssid, expected)
      assert.equal(f.attempts[0].options.password, expected === 'saved-ap' ? 'saved-secret' : 'profile-secret')
      f.attempts[0].options.onConnected()
    }
    assert.equal((await boot.connectivity.network.ready).status, expected ? 'connected' : 'skipped')
    await boot.close()
  }
})
