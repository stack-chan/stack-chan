import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import Timer from '../../testing/fakes/timer.js'
import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type {
  LocalPeerRadio,
  LocalPeerRadioFactory,
  LocalPeerRadioOptions,
  LocalPeerRadioReceiveEvent,
} from '../local-peer-radio-types.js'
import type { LocalPeerMessage } from '../local-peer-types.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(modulesRoot, 'local-peer-codec', resolve(modulesRoot, 'connectivity/local-peer-codec.js'))
writeAliasPackage(modulesRoot, 'local-peer-frame', resolve(modulesRoot, 'connectivity/local-peer-frame.js'))
writeAliasPackage(modulesRoot, 'local-peer-types', resolve(modulesRoot, 'connectivity/local-peer-types.js'))
writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })

const { decodeLocalPeerFrame, LocalPeerFrameKind } = await import('../local-peer-frame.js')
const { LocalPeerService } = await import('../local-peer-service.js')

;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => undefined

type DropFrame = (from: string, to: string | undefined, data: ArrayBuffer) => boolean

class FakeRadioNetwork {
  readonly endpoints = new Map<string, FakeRadio>()
  dropFrame?: DropFrame
  failAdd = false
  failSend = false

  factory(id: string): LocalPeerRadioFactory {
    return (options) => {
      const endpoint = new FakeRadio(this, id, options)
      this.endpoints.set(id, endpoint)
      return endpoint
    }
  }

  remove(id: string): void {
    this.endpoints.delete(id)
  }

  deliver(sender: FakeRadio, peerId: string | undefined, data: ArrayBuffer): void {
    if (this.dropFrame?.(sender.id, peerId, data)) return
    const recipients = peerId ? [this.endpoints.get(peerId)] : [...this.endpoints.values()]
    for (const recipient of recipients) {
      if (!recipient || recipient === sender || recipient.closed) continue
      const pointToPoint = peerId !== undefined
      const bothSecured = sender.securePeers.has(recipient.id) && recipient.securePeers.has(sender.id)
      if (pointToPoint && bothSecured && sender.sharedKey !== recipient.sharedKey) continue
      const secure = pointToPoint && bothSecured && sender.sharedKey !== undefined
      const copy = data.slice(0)
      recipient.receive({ peerId: sender.id, data: copy, secure })
    }
  }
}

class FakeRadio implements LocalPeerRadio {
  readonly securePeers = new Set<string>()
  readonly sharedKey?: string
  closed = false
  #network: FakeRadioNetwork
  #onReceive: (event: LocalPeerRadioReceiveEvent) => void
  readonly id: string

  constructor(network: FakeRadioNetwork, id: string, options: LocalPeerRadioOptions) {
    this.#network = network
    this.id = id
    this.sharedKey = options.sharedKey
    this.#onReceive = options.onReceive
  }

  addPeer(peerId: string, secure: boolean): void {
    if (this.#network.failAdd) throw new Error('injected add peer failure')
    if (secure) this.securePeers.add(peerId)
    else this.securePeers.delete(peerId)
  }

  removePeer(peerId: string): void {
    this.securePeers.delete(peerId)
  }

  async send(peerId: string | undefined, data: ArrayBuffer): Promise<void> {
    if (this.closed) throw new Error('closed')
    if (this.#network.failSend) throw new Error('injected send failure')
    this.#network.deliver(this, peerId, data)
  }

  receive(event: LocalPeerRadioReceiveEvent): void {
    this.#onReceive(event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.#network.remove(this.id)
  }
}

async function openPair(options: { sharedKey?: string; services?: [string, string] } = {}) {
  const network = new FakeRadioNetwork()
  const first = new LocalPeerService('001122334455', network.factory('001122334455'))
  const second = new LocalPeerService('AABBCCDDEEFF', network.factory('AABBCCDDEEFF'))
  const firstSession = await first.open({
    service: options.services?.[0] ?? 'test.stackchan',
    displayName: 'first',
    sharedKey: options.sharedKey,
  })
  const secondSession = await second.open({
    service: options.services?.[1] ?? 'test.stackchan',
    displayName: 'second',
    sharedKey: options.sharedKey,
  })
  return { network, first, second, firstSession, secondSession }
}

test('local peer discovery finds only peers in the same service', async () => {
  Timer.reset()
  const pair = await openPair()
  assert.deepEqual(await pair.firstSession.discover({ timeoutMs: 0 }), [
    { id: 'AABBCCDDEEFF', name: 'second', secure: false },
  ])
  pair.firstSession.close()
  pair.secondSession.close()

  const isolated = await openPair({ services: ['service.one', 'service.two'] })
  assert.deepEqual(await isolated.firstSession.discover({ timeoutMs: 0 }), [])
  isolated.firstSession.close()
  isolated.secondSession.close()
})

test('local peer reliable messages reassemble, acknowledge, and support unsubscribe', async () => {
  Timer.reset()
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  const received: LocalPeerMessage[] = []
  const unsubscribe = pair.secondSession.subscribe('pose.changed', (message) => received.push(message))
  const payload = { text: 'あ'.repeat(400), pose: { pan: 0.25, tilt: -0.1 } }

  const receipt = await pair.firstSession.send('AABBCCDDEEFF', 'pose.changed', payload)
  assert.equal(receipt.peerId, 'AABBCCDDEEFF')
  assert.equal(receipt.attempts, 1)
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].payload, payload)
  assert.equal(received[0].peer.id, '001122334455')

  unsubscribe()
  await pair.firstSession.send('AABBCCDDEEFF', 'pose.changed', { text: 'ignored' })
  assert.equal(received.length, 1)
  pair.firstSession.close()
  pair.secondSession.close()
})

test('local peer broadcast is delivered without acknowledgement', async () => {
  Timer.reset()
  const pair = await openPair()
  const received: LocalPeerMessage[] = []
  pair.secondSession.subscribe('*', (message) => received.push(message))
  const receipt = await pair.firstSession.broadcast('presence', { online: true })
  assert.match(receipt.messageId, /^[0-9a-f]{8}$/)
  assert.deepEqual(
    received.map((message) => message.payload),
    [{ online: true }],
  )
  pair.firstSession.close()
  pair.secondSession.close()
})

test('local peer retries duplicate data without delivering it twice and eventually times out', async () => {
  Timer.reset()
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  let deliveries = 0
  pair.secondSession.subscribe('retry', () => {
    deliveries += 1
  })
  pair.network.dropFrame = (_from, _to, data) => decodeLocalPeerFrame(data)?.kind === LocalPeerFrameKind.ACK

  const sending = pair.firstSession.send('AABBCCDDEEFF', 'retry', { value: 1 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await Promise.resolve()
    await Promise.resolve()
    Timer.advance(250)
  }
  await assert.rejects(sending, (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'timeout'
  })
  assert.equal(deliveries, 1)
  pair.firstSession.close()
  pair.secondSession.close()
})

test('local peer shared key marks acknowledged point-to-point peers secure', async () => {
  Timer.reset()
  const pair = await openPair({ sharedKey: 'correct horse battery staple' })
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  let message: LocalPeerMessage | undefined
  pair.secondSession.subscribe('secure', (received) => {
    message = received
  })
  await pair.firstSession.send('AABBCCDDEEFF', 'secure', { protected: true })
  assert.equal(message?.peer.secure, true)
  pair.firstSession.close()
  pair.secondSession.close()
})

test('local peer reports peer registration failures through the abstract error contract', async () => {
  Timer.reset()
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  pair.network.failAdd = true

  await assert.rejects(pair.firstSession.send('AABBCCDDEEFF', 'hello', { value: 1 }), (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'transport'
  })
  pair.firstSession.close()
  pair.secondSession.close()
})

test('local peer failed open releases the radio and allows a later session', async () => {
  Timer.reset()
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  network.failSend = true

  await assert.rejects(service.open({ service: 'test.stackchan' }), (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'transport'
  })
  assert.equal(network.endpoints.size, 0)

  network.failSend = false
  const session = await service.open({ service: 'test.stackchan' })
  session.close()
})

test('local peer close cancels an active discovery wait and reserves wildcard for subscriptions', async () => {
  Timer.reset()
  const pair = await openPair()
  const wildcardMessages: LocalPeerMessage[] = []
  pair.firstSession.subscribe('*', (message) => wildcardMessages.push(message))
  await assert.rejects(pair.firstSession.broadcast('*', { invalid: true }), (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'invalid-argument'
  })

  const discovering = pair.firstSession.discover({ timeoutMs: 1000 })
  await Promise.resolve()
  await Promise.resolve()
  pair.firstSession.close()
  await assert.rejects(discovering, (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'closed'
  })
  assert.deepEqual(wildcardMessages, [])
  pair.secondSession.close()
})
