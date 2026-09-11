import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AppNetwork } from '../../sdk/extensions/network.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type createNativeNetwork from './app-network-native.js'
import type { AppServiceScope } from './app-service-scope.js'

async function setup(t: TestContext, beacon = false) {
  const source = dirname(fileURLToPath(import.meta.url))
  const root = mkdtempSync(resolve(tmpdir(), 'stackchan-native-network-'))
  // Keep the native dependency fakes out of other concurrent tests' alias trees.
  writeFileSync(resolve(root, 'package.json'), '{"type":"module"}')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(source, '../../sdk/errors.js'))
  for (const name of ['app-network-native', 'cancellation', 'owned-resources', 'app-service-scope']) {
    copyFileSync(resolve(source, `${name}.js`), resolve(root, `${name}.js`))
    writeAliasPackage(root, name, resolve(root, `${name}.js`))
  }
  const fake = resolve(source, '__tests__/fakes/native-network.js')
  for (const name of [
    'loadPreference',
    'WebSocket',
    'app-http',
    'beacon-packet',
    'bleclient',
    'bleserver',
    'btutils',
    'ecma-wifi',
    'http-delimited-stream',
    'http-server-service',
    'mcp-server',
    'stk-server',
    'url',
  ])
    writeAliasPackage(root, name, fake, { hasDefaultExport: true })
  const ble = await import('./__tests__/fakes/ble-server.js')
  if (beacon) {
    ble.default.instances.length = 0
    for (const name of ['bleserver', 'bleclient', 'beacon-packet', 'btutils'])
      writeAliasPackage(root, name, resolve(source, '__tests__/fakes/ble-server.js'), { hasDefaultExport: true })
  }
  const [{ default: createNetwork }, fakes] = await Promise.all([
    import(pathToFileURL(resolve(root, 'app-network-native.js')).href) as Promise<{
      default: typeof createNativeNetwork
    }>,
    import('./__tests__/fakes/native-network.js'),
  ])
  const resources = new Set<() => void | Promise<void>>()
  const errors: unknown[] = []
  const scope: AppServiceScope = {
    call: (operation) => operation(),
    run: () => {
      throw new Error('unexpected asynchronous request')
    },
    own: (dispose) => {
      resources.add(dispose)
      let closing: Promise<void> | undefined
      return () =>
        (closing ??= Promise.resolve()
          .then(dispose)
          .finally(() => {
            resources.delete(dispose)
          }))
    },
    report: (error) => errors.push(error),
  }
  fakes.resetNativeNetwork()
  return { network: createNetwork(scope), resources, errors, fakes, ble }
}

test('DNS-SD retains the latest copied TXT while claiming a name and ignores callbacks after close', async (t) => {
  const f = await setup(t)
  const events: string[] = []
  let ready!: () => void
  const published: Map<string, string>[] = []
  let advertisements = 0
  const previous = (globalThis as { device?: unknown }).device
  ;(globalThis as { device?: unknown }).device = {
    network: {
      dnssd: {
        io: class {
          claim(options: { onReady(): void }) {
            ready = options.onReady
            return {
              close() {
                events.push('claim')
              },
            }
          }
          advertise(options: { txt: Map<string, string> }) {
            advertisements++
            published.push(options.txt)
            return {
              close() {
                events.push('advertisement')
              },
              updateTXT(txt: Map<string, string>) {
                published.push(txt)
              },
            }
          }
          close() {
            events.push('dns')
          }
        },
      },
    },
  }
  try {
    const initial = { state: 'initial' }
    const service = f.network.advertiseService({
      host: 'robot',
      name: 'robot',
      serviceType: '_http._tcp',
      port: 80,
      txt: initial,
    })
    initial.state = 'mutated'
    const update = { state: 'latest' }
    service.update(update)
    update.state = 'mutated too'
    ready()
    assert.deepEqual([...published[0]], [['state', 'latest']])
    ready()
    assert.equal(advertisements, 1)
    service.update({ state: 'live' })
    assert.deepEqual([...published[published.length - 1]], [['state', 'live']])
    await service.close()
    ready()
    assert.equal(advertisements, 1)
    assert.throws(() => service.update({ state: 'closed' }), { code: 'CLOSED' })
    assert.deepEqual(events, ['advertisement', 'claim', 'dns'])
    assert.equal(f.resources.size, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    ;(globalThis as { device?: unknown }).device = previous
  }
})

test('invalid network ports, beacon roles and UUIDs fail before opening a native connection', async (t) => {
  const f = await setup(t)
  const invalid: Array<() => unknown> = [
    ...[0, 80.5, 65_536, NaN].flatMap((port) => [
      () => f.network.serve({ port, routes: [] }),
      () => f.network.serveTools({ port, tools: [] }),
      () => f.network.advertiseService({ host: 'robot', name: 'robot', serviceType: '_http._tcp', port, txt: {} }),
    ]),
    () => f.network.beacon({ role: 'advertiser', uuid: '-'.repeat(36) }),
    () =>
      f.network.beacon({ role: 'wrong', uuid: '12345678-1234-1234-1234-123456789012' } as unknown as Parameters<
        AppNetwork['beacon']
      >[0]),
  ]
  for (const operation of invalid) assert.throws(operation, { code: 'INVALID_ARGUMENT' })
  for (let i = 0; i < 16; i++) await Promise.resolve()
  assert.equal(f.fakes.connections, 0)
  assert.equal(f.resources.size, 0)
  assert.deepEqual(f.errors, [])
})

test('beacon startup copies accepted data and closed connections ignore delayed native events', async (t) => {
  const f = await setup(t, true)
  const options: Parameters<AppNetwork['beacon']>[0] = {
    role: 'advertiser',
    uuid: '01234567-89ab-cdef-1032-547698badcfe',
  }
  type Radio = InstanceType<typeof f.ble.default> & {
    onReady(): void
    onConnected(): void
    onDiscovered(device: unknown): void
  }
  for (let cycle = 0; cycle < 100; cycle++) {
    options.role = 'advertiser'
    const connection = f.network.beacon(options)
    const radio = f.ble.default.instances.at(-1) as Radio
    const data = { sequence: cycle, command: 65535 - cycle }
    connection.advertise(data)
    data.sequence = -1
    options.role = 'scanner'
    radio.onReady()
    const payload = (radio.advertising[0] as { advertisingData: { manufacturerSpecific: { data: number[] } } })
      .advertisingData.manufacturerSpecific.data
    assert.deepEqual(payload, [cycle, 65535 - cycle])
    radio.onConnected()
    assert.equal(radio.advertisingStops, 1)
    await connection.close()
    await connection.close()
    radio.onReady()
    radio.onConnected()
    assert.equal(radio.closeCalls, 1)
    assert.equal(radio.advertising.length, 1)
    assert.equal(radio.advertisingStops, 1)
    assert.throws(() => connection.advertise({ sequence: 1, command: 2 }), { code: 'CLOSED' })

    const scanner = f.network.beacon({ ...options, role: 'scanner' })
    const scan = f.ble.default.instances.at(-1) as Radio
    scan.onReady()
    assert.equal(scan.scans.length, 1)
    await scanner.close()
    scan.onReady()
    scan.onDiscovered({
      get scanResponse() {
        throw new Error('closed scanner read native packet')
      },
    })
    assert.equal(scan.scans.length, 1)
    assert.equal(f.resources.size, 0)
    assert.deepEqual(f.errors, [])
    f.ble.default.instances.length = 0
  }
})
