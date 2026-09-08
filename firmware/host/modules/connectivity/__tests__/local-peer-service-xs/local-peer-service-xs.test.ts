import { CancellationSource } from 'cancellation'
import { decodeLocalPeerFrame, LocalPeerFrameKind } from 'local-peer-frame'
import type {
  LocalPeerRadio,
  LocalPeerRadioFactory,
  LocalPeerRadioOptions,
  LocalPeerRadioReceiveEvent,
} from 'local-peer-radio-types'
import { LocalPeerService } from 'local-peer-service'
import type { LocalPeerMessage, LocalPeerSession } from 'local-peer-types'
import { StackchanError } from 'stackchan/errors'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

type DropFrame = (from: string, to: string | undefined, data: ArrayBuffer) => boolean

class FakeRadioNetwork {
  readonly endpoints = new Map<string, FakeRadio>()
  dropFrame?: DropFrame
  failAdd = false
  failSend = false
  failClose = false
  holdSend?: () => Promise<void>

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
    if (this.closed) throw new Error('CLOSED')
    if (this.#network.failSend) throw new Error('injected send failure')
    // Hardware receive callbacks run on a later event-loop turn. Preserve that
    // boundary so the fake does not create impossible recursive radio stacks.
    await Promise.resolve()
    if (this.#network.holdSend) await this.#network.holdSend()
    this.#network.deliver(this, peerId, data)
  }

  receive(event: LocalPeerRadioReceiveEvent): void {
    this.#onReceive(event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.#network.remove(this.id)
    if (this.#network.failClose) throw new Error('injected close failure')
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
  assert(caught instanceof StackchanError, `${message}: SDK error class`)
  equal((caught as Error).name, 'StackchanError', `${message}: error name after XS preload`)
  equal((caught as { code?: string })?.code, code, message)
}

async function settle(): Promise<void> {
  // Drain the radio's microtasks without depending on their internal chain length.
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 0))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise<void>((resolve) => Timer.set(() => resolve(), 5))
  }
  assert(condition(), message)
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
  await waitFor(() => received.length > 0, 'accepted message must reach its subscriber')
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
  await waitFor(() => reply !== undefined, 'accepted request must reach its reply handler')
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
  await waitFor(() => received.length > 0, 'broadcast must reach its subscriber')
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
    'TIMEOUT',
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
  await waitFor(() => message !== undefined, 'secure message must reach its subscriber')
  equal(message?.peer.secure, true, 'shared-key point-to-point traffic should be secure')
  closePair(pair)
}

async function testPeerRegistrationFailure(): Promise<void> {
  const pair = await openPair()
  await pair.firstSession.discover({ timeoutMs: 0 })
  pair.network.failAdd = true
  await expectCode(
    pair.firstSession.send('AABBCCDDEEFF', 'hello', { value: 1 }),
    'IO',
    'peer registration failures should use the abstract transport error',
  )
  closePair(pair)
}

async function testFailedOpenCleanup(): Promise<void> {
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  network.failSend = true
  await expectCode(service.open({ service: 'test.stackchan' }), 'IO', 'failed open should report transport')
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
    'UNSUPPORTED',
    'an unavailable explicit transport should be rejected',
  )
}

async function testCloseAndWildcard(): Promise<void> {
  const pair = await openPair()
  const wildcardMessages: LocalPeerMessage[] = []
  pair.firstSession.subscribe('*', (message) => wildcardMessages.push(message))
  await expectCode(
    pair.firstSession.broadcast('*', { invalid: true }),
    'INVALID_ARGUMENT',
    'wildcard should be reserved for subscriptions',
  )

  const discovering = pair.firstSession.discover({ timeoutMs: 1000 })
  await settle()
  pair.firstSession.close()
  await expectCode(discovering, 'CLOSED', 'close should cancel active discovery')
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
  await waitFor(() => handlerRan, 'close handler must run after acknowledgement')
  equal(receipt.attempts, 1, 'subscriber close should not cancel an accepted message acknowledgement')
  equal(handlerRan, true, 'subscriber should run after acknowledgement completes')
  pair.firstSession.close()
}

async function testServiceClose(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const network = new FakeRadioNetwork()
    const service = new LocalPeerService('001122334455', network.factory('001122334455'))
    const session = await service.open({ service: 'test.stackchan' })
    service.close()
    service.close()
    equal(network.endpoints.size, 0, 'host close releases the session radio')
    await expectCode(session.broadcast('CLOSED', {}), 'CLOSED', 'borrowed session cannot outlive host')
    await expectCode(service.open({ service: 'test.stackchan' }), 'CLOSED', 'closed service cannot open another radio')
  }
}

async function testClosePendingOpen(): Promise<void> {
  const network = new FakeRadioNetwork()
  let finish: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  network.holdSend = () => pending
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  const opening = service.open({ service: 'test.stackchan' })
  await settle()
  service.close()
  await expectCode(opening, 'CLOSED', 'close settles open even when native send never completes')
  finish()
  await settle()
  equal(network.endpoints.size, 0, 'late native completion cannot restore a closed radio')
}

async function testCloseFailure(): Promise<void> {
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  const session = await service.open({ service: 'test.stackchan' })
  network.failClose = true
  let failure: unknown
  try {
    session.close()
  } catch (error) {
    failure = error
  }
  equal((failure as { code?: string })?.code, 'IO', 'session close reports radio failure')
  await expectCode(service.open({ service: 'test.stackchan' }), 'IO', 'failed cleanup prevents service reuse')
  failure = undefined
  try {
    service.close()
  } catch (error) {
    failure = error
  }
  equal((failure as { code?: string })?.code, 'IO', 'host close preserves prior session close failure')
}

async function testCancelledOpen(): Promise<void> {
  const network = new FakeRadioNetwork()
  const service = new LocalPeerService('001122334455', network.factory('001122334455'))
  const immediate = new CancellationSource()
  const openingImmediately = service.open({ service: 'test.stackchan' }, immediate.signal)
  immediate.cancel()
  await expectCode(openingImmediately, 'CANCELLED', 'cancel before announce keeps the cancellation reason')
  equal(network.endpoints.size, 0, 'early cancellation closes the radio before protocol I/O')
  for (let cycle = 0; cycle < 100; cycle++) {
    const source = new CancellationSource()
    let finish!: () => void
    network.holdSend = () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
    const opening = service.open({ service: 'test.stackchan' }, source.signal)
    const failed = expectCode(opening, 'CANCELLED', 'cancel open reports SDK cancellation')
    await settle()
    source.cancel()
    await failed
    equal(network.endpoints.size, 0, 'cancel open closes the acquired radio')
    finish()
    await settle()
    equal(network.endpoints.size, 0, 'late announce does not restore the radio')
    equal(source.size, 0, 'open cancellation releases its subscription')
  }
  network.holdSend = undefined
  const source = new CancellationSource()
  const session = await service.open({ service: 'test.stackchan' }, source.signal)
  equal(source.size, 0, 'successful open no longer belongs to the setup operation')
  source.cancel()
  await session.discover({ timeoutMs: 0 })
  session.close()
  service.close()
}

async function testCancelledOperations(): Promise<void> {
  const pair = await openPair()
  const discovering = new CancellationSource()
  const discovery = pair.firstSession.discover({ timeoutMs: 60_000, signal: discovering.signal })
  const cancelledDiscovery = expectCode(discovery, 'CANCELLED', 'discovery is cancelled without waiting for its timer')
  await settle()
  discovering.cancel()
  await cancelledDiscovery
  equal(discovering.size, 0, 'discovery listener is released')

  let sends = 0
  pair.network.dropFrame = (from, _to, data) => {
    const kind = decodeLocalPeerFrame(data)?.kind
    if (from === '001122334455' && kind === LocalPeerFrameKind.DATA) sends++
    return kind === LocalPeerFrameKind.ACK
  }
  const sending = new CancellationSource()
  const send = pair.firstSession.send('AABBCCDDEEFF', 'cancelled', { value: 1 }, { signal: sending.signal })
  const cancelledSend = expectCode(send, 'CANCELLED', 'reliable send cancels while awaiting acknowledgement')
  await waitFor(() => sends > 0, 'first frame is transmitted')
  sending.cancel()
  await cancelledSend
  const before = sends
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 600))
  equal(sends, before, 'cancelled send has no retry after the ACK deadline')
  equal(sending.size, 0, 'send cancellation releases its listener')
  pair.network.dropFrame = undefined
  const receipt = await pair.firstSession.send('AABBCCDDEEFF', 'again', { value: 2 })
  equal(receipt.attempts, 1, 'session can send again after cancellation')

  let finish!: () => void
  let nativeSends = 0
  pair.network.holdSend = () => {
    nativeSends++
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  }
  const broadcasting = new CancellationSource()
  const broadcast = pair.firstSession.broadcast(
    'cancelled',
    { text: 'x'.repeat(1200) },
    { signal: broadcasting.signal },
  )
  const cancelledBroadcast = expectCode(broadcast, 'CANCELLED', 'broadcast cancels while a fragment is pending')
  await settle()
  broadcasting.cancel()
  await cancelledBroadcast
  equal(nativeSends, 1, 'only the accepted fragment reached the radio')
  pair.network.holdSend = undefined
  finish()
  await settle()
  equal(nativeSends, 1, 'late completion cannot enqueue further fragments')
  equal(broadcasting.size, 0, 'broadcast cancellation releases its listener')
  await pair.firstSession.broadcast('again', { value: 3 })
  closePair(pair)
}

async function runTest(): Promise<void> {
  trace('=== local-peer-service XS test ===\n')
  trace('running testDiscovery\n')
  await testDiscovery()
  trace('running testReliableDelivery\n')
  await testReliableDelivery()
  trace('running testAcknowledgementOrder\n')
  await testAcknowledgementOrder()
  trace('running testBroadcast\n')
  await testBroadcast()
  trace('running testRetryDeduplication\n')
  await testRetryDeduplication()
  trace('running testSharedKey\n')
  await testSharedKey()
  trace('running testPeerRegistrationFailure\n')
  await testPeerRegistrationFailure()
  trace('running testFailedOpenCleanup\n')
  await testFailedOpenCleanup()
  trace('running testTransportSelection\n')
  await testTransportSelection()
  trace('running testCloseAndWildcard\n')
  await testCloseAndWildcard()
  trace('running testCloseFromSubscriber\n')
  await testCloseFromSubscriber()
  trace('running testServiceClose\n')
  await testServiceClose()
  trace('running testClosePendingOpen\n')
  await testClosePendingOpen()
  trace('running testCloseFailure\n')
  await testCloseFailure()
  await testCancelledOpen()
  await testCancelledOperations()
  trace('ok\n')
}

runTest().catch((error) => {
  trace(`unhandled exception: local-peer-service XS test failed: ${String(error)}\n`)
  throw error
})
