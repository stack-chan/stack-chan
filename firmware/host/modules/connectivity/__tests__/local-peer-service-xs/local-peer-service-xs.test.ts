import { decodeLocalPeerFrame, LocalPeerFrameKind } from 'local-peer-frame'
import type {
  LocalPeerRadio,
  LocalPeerRadioFactory,
  LocalPeerRadioOptions,
  LocalPeerRadioReceiveEvent,
} from 'local-peer-radio-types'
import { LocalPeerService } from 'local-peer-service'
import type { LocalPeerMessage, LocalPeerSession } from 'local-peer-types'
import { assert, equal } from 'testing/assert'

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
      recipient.receive({ peerId: sender.id, data: data.slice(0), secure })
    }
  }
}

class FakeRadio implements LocalPeerRadio {
  readonly id: string
  readonly securePeers = new Set<string>()
  readonly sharedKey?: string
  closed = false
  #network: FakeRadioNetwork
  #onReceive: (event: LocalPeerRadioReceiveEvent) => void

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
    // Hardware receive callbacks run on a later event-loop turn. Preserve that
    // boundary so the fake does not create impossible recursive radio stacks.
    await Promise.resolve()
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

type OpenPair = {
  network: FakeRadioNetwork
  first: LocalPeerService
  second: LocalPeerService
  firstSession: LocalPeerSession
  secondSession: LocalPeerSession
}

async function openPair(options: { sharedKey?: string; services?: [string, string] } = {}): Promise<OpenPair> {
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

function closePair(pair: OpenPair): void {
  pair.firstSession.close()
  pair.secondSession.close()
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message)
}

async function expectCode(promise: Promise<unknown>, code: string, message: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  assert(caught !== undefined, `${message}: expected rejection`)
  equal((caught as { code?: string })?.code, code, message)
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function testDiscovery(): Promise<void> {
  const pair = await openPair()
  deepEqual(
    await pair.firstSession.discover({ timeoutMs: 0 }),
    [{ id: 'AABBCCDDEEFF', name: 'second', secure: false }],
    'discovery should find a peer in the same service',
  )
  closePair(pair)

  const isolated = await openPair({ services: ['service.one', 'service.two'] })
  deepEqual(await isolated.firstSession.discover({ timeoutMs: 0 }), [], 'discovery should isolate services')
  closePair(isolated)
}

async function testReliableDelivery(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  const received: LocalPeerMessage[] = []
  const unsubscribe = pair.secondSession.subscribe('pose.changed', (message) => received.push(message))
  const payload = { text: 'あ'.repeat(400), pose: { pan: 0.25, tilt: -0.1 } }

  const receipt = await pair.firstSession.send('AABBCCDDEEFF', 'pose.changed', payload)
  await settle()
  equal(receipt.peerId, 'AABBCCDDEEFF', 'delivery receipt should identify the peer')
  equal(receipt.attempts, 1, 'delivery should be acknowledged on the first attempt')
  equal(received.length, 1, 'reassembled message should be delivered once')
  deepEqual(received[0]?.payload, payload, 'fragmented UTF-8 payload should be reassembled')
  equal(received[0]?.peer.id, '001122334455', 'message should identify its sender')

  unsubscribe()
  await pair.firstSession.send('AABBCCDDEEFF', 'pose.changed', { text: 'ignored' })
  await settle()
  equal(received.length, 1, 'unsubscribe should stop delivery')
  closePair(pair)
}

async function testAcknowledgementOrder(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  const secondPeerFrames: number[] = []
  pair.network.dropFrame = (from, to, data) => {
    if (from === 'AABBCCDDEEFF' && to === '001122334455') {
      const frame = decodeLocalPeerFrame(data)
      if (frame) secondPeerFrames.push(frame.kind)
    }
    return false
  }
  let reply: Promise<unknown> | undefined
  pair.secondSession.subscribe('request', () => {
    reply = pair.secondSession.send('001122334455', 'reply', { value: 2 })
  })

  await pair.firstSession.send('AABBCCDDEEFF', 'request', { value: 1 })
  await settle()
  assert(reply !== undefined, 'request subscriber should send a reply')
  if (reply) await reply
  deepEqual(
    secondPeerFrames.slice(0, 2),
    [LocalPeerFrameKind.ACK, LocalPeerFrameKind.DATA],
    'acknowledgement should be sent before a subscriber reply',
  )
  closePair(pair)
}

async function testBroadcast(): Promise<void> {
  const pair = await openPair()
  const received: LocalPeerMessage[] = []
  pair.secondSession.subscribe('*', (message) => received.push(message))
  const receipt = await pair.firstSession.broadcast('presence', { online: true })
  await settle()
  assert(/^[0-9a-f]{8}$/.test(receipt.messageId), 'broadcast should return a hexadecimal message id')
  deepEqual(
    received.map((message) => message.payload),
    [{ online: true }],
    'broadcast should be delivered',
  )
  closePair(pair)
}

async function testRetryDeduplication(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  let deliveries = 0
  pair.secondSession.subscribe('retry', () => {
    deliveries += 1
  })
  pair.network.dropFrame = (_from, _to, data) => decodeLocalPeerFrame(data)?.kind === LocalPeerFrameKind.ACK

  await expectCode(
    pair.firstSession.send('AABBCCDDEEFF', 'retry', { value: 1 }),
    'timeout',
    'missing acknowledgements should time out',
  )
  equal(deliveries, 1, 'retried data should not be delivered twice')
  closePair(pair)
}

async function testSharedKey(): Promise<void> {
  const pair = await openPair({ sharedKey: 'correct horse battery staple' })
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  let message: LocalPeerMessage | undefined
  pair.secondSession.subscribe('secure', (received) => {
    message = received
  })
  await pair.firstSession.send('AABBCCDDEEFF', 'secure', { protected: true })
  await settle()
  equal(message?.peer.secure, true, 'shared-key point-to-point traffic should be secure')
  closePair(pair)
}

async function testPeerRegistrationFailure(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  pair.network.failAdd = true
  await expectCode(
    pair.firstSession.send('AABBCCDDEEFF', 'hello', { value: 1 }),
    'transport',
    'peer registration failures should use the abstract transport error',
  )
  closePair(pair)
}

async function testFailedOpenCleanup(): Promise<void> {
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  network.failSend = true
  await expectCode(service.open({ service: 'test.stackchan' }), 'transport', 'failed open should report transport')
  equal(network.endpoints.size, 0, 'failed open should release its radio')

  network.failSend = false
  const session = await service.open({ service: 'test.stackchan' })
  session.close()
}

async function testTransportSelection(): Promise<void> {
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', {
    defaultTransport: 'ble',
    factories: { ble: network.factory('001122334455') },
  })
  const session = await service.open({ service: 'test.stackchan' })
  session.close()
  await expectCode(
    service.open({ service: 'test.stackchan', transport: 'espnow' }),
    'not-supported',
    'an unavailable explicit transport should be rejected',
  )
}

async function testCloseAndWildcard(): Promise<void> {
  const pair = await openPair()
  const wildcardMessages: LocalPeerMessage[] = []
  pair.firstSession.subscribe('*', (message) => wildcardMessages.push(message))
  await expectCode(
    pair.firstSession.broadcast('*', { invalid: true }),
    'invalid-argument',
    'wildcard should be reserved for subscriptions',
  )

  const discovering = pair.firstSession.discover({ timeoutMs: 1000 })
  await settle()
  pair.firstSession.close()
  await expectCode(discovering, 'closed', 'close should cancel active discovery')
  deepEqual(wildcardMessages, [], 'discovery should not deliver wildcard messages')
  pair.secondSession.close()
}

async function testCloseFromSubscriber(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  await pair.secondSession.discover({ timeoutMs: 0 })
  let handlerRan = false
  pair.secondSession.subscribe('close', () => {
    handlerRan = true
    pair.secondSession.close()
  })

  const receipt = await pair.firstSession.send('AABBCCDDEEFF', 'close', { accepted: true })
  await settle()
  equal(receipt.attempts, 1, 'subscriber close should not cancel an accepted message acknowledgement')
  equal(handlerRan, true, 'subscriber should run after acknowledgement completes')
  pair.firstSession.close()
}

async function runTest(): Promise<void> {
  trace('=== local-peer-service XS test ===\n')
  await testDiscovery()
  await testReliableDelivery()
  await testAcknowledgementOrder()
  await testBroadcast()
  await testRetryDeduplication()
  await testSharedKey()
  await testPeerRegistrationFailure()
  await testFailedOpenCleanup()
  await testTransportSelection()
  await testCloseAndWildcard()
  await testCloseFromSubscriber()
  trace('ok\n')
}

runTest().catch((error) => {
  trace(`local-peer-service XS test failed: ${String(error)}\n`)
  throw error
})
