import Timer from 'timer'
import { decodeUTF8, encodeUTF8, fnv1a32 } from 'local-peer-codec'
import {
  decodeLocalPeerFrame,
  encodeLocalPeerFrame,
  fragmentLocalPeerPayload,
  LOCAL_PEER_FRAGMENT_BYTES,
  LocalPeerFrameFlag,
  LocalPeerFrameKind,
  type LocalPeerFrame,
} from 'local-peer-frame'
import type { LocalPeerRadio, LocalPeerRadioFactory, LocalPeerRadioReceiveEvent } from 'local-peer-radio-types'
import {
  type JsonValue,
  type LocalPeerBroadcastReceipt,
  type LocalPeerCapability,
  type LocalPeerDeliveryReceipt,
  LocalPeerError,
  type LocalPeerInfo,
  type LocalPeerMessage,
  type LocalPeerOpenOptions,
  type LocalPeerSession,
} from 'local-peer-types'

const DEFAULT_OFFLINE_CHANNEL = 1
const DEFAULT_DISCOVERY_TIMEOUT_MS = 750
const ACK_TIMEOUT_MS = 250
const MAX_SEND_ATTEMPTS = 3
const REASSEMBLY_TIMEOUT_MS = 2000
const DEDUPLICATION_WINDOW_MS = 30_000
const MAX_MESSAGE_BYTES = 2048
const MAX_REASSEMBLIES = 8
const MAX_UNSECURED_PEERS = 19
const MAX_SECURED_PEERS = 6
const MAX_DELIVERED_MESSAGES = 64
const MAX_SERVICE_BYTES = 64
const MAX_TYPE_BYTES = 64
const MAX_NAME_BYTES = 32
const MIN_SHARED_KEY_BYTES = 16
const MAX_SHARED_KEY_BYTES = 64

type TimerHandle = ReturnType<typeof Timer.set>

type MessageEnvelope = {
  service: string
  type: string
  payload: JsonValue
}

type DiscoveryEnvelope = {
  service: string
  name?: string
}

type PeerRecord = LocalPeerInfo & {
  lastSeen: number
}

type ReassemblyRecord = {
  peerId: string
  messageId: number
  flags: number
  fragmentCount: number
  fragments: Array<Uint8Array | undefined>
  received: number
  secure: boolean
  timer: TimerHandle
  createdAt: number
}

type PendingSend = {
  peerId: string
  frames: ArrayBuffer[]
  attempts: number
  timer?: TimerHandle
  resolve: (receipt: LocalPeerDeliveryReceipt) => void
  reject: (error: LocalPeerError) => void
}

let nextMessageId = (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000) ^ 0x534c5031) >>> 0

function allocateMessageId(): number {
  nextMessageId = (nextMessageId + 1) >>> 0
  if (nextMessageId === 0) nextMessageId = 1
  return nextMessageId
}

function formatMessageId(messageId: number): string {
  return messageId.toString(16).padStart(8, '0')
}

function validateBoundedText(label: string, value: string, maximumBytes: number, allowEmpty = false): void {
  const bytes = encodeUTF8(value).byteLength
  if ((!allowEmpty && bytes === 0) || bytes > maximumBytes) {
    throw new LocalPeerError(
      'invalid-argument',
      `${label} must contain ${allowEmpty ? `at most ${maximumBytes}` : `1-${maximumBytes}`} UTF-8 bytes`,
    )
  }
}

function validateOpenOptions(options: LocalPeerOpenOptions): void {
  if (!options || typeof options !== 'object') throw new LocalPeerError('invalid-argument', 'options are required')
  if (typeof options.service !== 'string') throw new LocalPeerError('invalid-argument', 'service must be a string')
  validateBoundedText('service', options.service, MAX_SERVICE_BYTES)
  if (options.displayName !== undefined) {
    if (typeof options.displayName !== 'string') {
      throw new LocalPeerError('invalid-argument', 'displayName must be a string')
    }
    validateBoundedText('displayName', options.displayName, MAX_NAME_BYTES, true)
  }
  if (options.sharedKey !== undefined) {
    if (typeof options.sharedKey !== 'string')
      throw new LocalPeerError('invalid-argument', 'sharedKey must be a string')
    const bytes = encodeUTF8(options.sharedKey).byteLength
    if (options.sharedKey.includes('\0') || bytes < MIN_SHARED_KEY_BYTES || bytes > MAX_SHARED_KEY_BYTES) {
      throw new LocalPeerError(
        'invalid-argument',
        `sharedKey must contain ${MIN_SHARED_KEY_BYTES}-${MAX_SHARED_KEY_BYTES} UTF-8 bytes without NUL characters`,
      )
    }
  }
}

function validateMessageType(type: string): void {
  if (typeof type !== 'string') throw new LocalPeerError('invalid-argument', 'message type must be a string')
  if (type === '*') throw new LocalPeerError('invalid-argument', 'message type * is reserved for subscriptions')
  validateBoundedText('message type', type, MAX_TYPE_BYTES)
}

function validatePeerId(peerId: string): void {
  if (typeof peerId !== 'string' || !/^[0-9A-Fa-f]{12}$/.test(peerId)) {
    throw new LocalPeerError('invalid-argument', 'peerId is invalid')
  }
}

function validateJsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): asserts value is JsonValue {
  if (depth > 16) throw new LocalPeerError('invalid-argument', 'payload nesting is too deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LocalPeerError('invalid-argument', 'payload numbers must be finite')
    return
  }
  if (typeof value !== 'object') throw new LocalPeerError('invalid-argument', 'payload must be JSON-compatible')
  if (ancestors.has(value)) throw new LocalPeerError('invalid-argument', 'payload must not contain cycles')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, ancestors, depth + 1)
  } else {
    for (const item of Object.values(value)) validateJsonValue(item, ancestors, depth + 1)
  }
  ancestors.delete(value)
}

function encodeEnvelope(service: string, type: string, payload: JsonValue): Uint8Array {
  validateMessageType(type)
  validateJsonValue(payload)
  let serialized: string
  try {
    serialized = JSON.stringify({ service, type, payload } satisfies MessageEnvelope)
  } catch (_error) {
    throw new LocalPeerError('invalid-argument', 'payload could not be serialized')
  }
  const bytes = encodeUTF8(serialized)
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    throw new LocalPeerError('message-too-large', `encoded message exceeds ${MAX_MESSAGE_BYTES} bytes`)
  }
  return bytes
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(decodeUTF8(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch (_error) {
    return undefined
  }
}

function publicPeer(record: PeerRecord): LocalPeerInfo {
  return { id: record.id, name: record.name, secure: record.secure }
}

export class LocalPeerService implements LocalPeerCapability {
  readonly id: string
  #radioFactory: LocalPeerRadioFactory
  #offlineChannel: number
  #session?: LocalPeerSessionImpl

  constructor(id: string, radioFactory: LocalPeerRadioFactory, options: { offlineChannel?: number } = {}) {
    validatePeerId(id)
    const channel = options.offlineChannel ?? DEFAULT_OFFLINE_CHANNEL
    if (!Number.isInteger(channel) || channel < 1 || channel > 13) {
      throw new LocalPeerError('invalid-argument', 'offlineChannel must be between 1 and 13')
    }
    this.id = id.toUpperCase()
    this.#radioFactory = radioFactory
    this.#offlineChannel = channel
  }

  async open(options: LocalPeerOpenOptions): Promise<LocalPeerSession> {
    validateOpenOptions(options)
    if (this.#session && !this.#session.closed) {
      throw new LocalPeerError('invalid-argument', 'a local peer session is already open')
    }
    let session: LocalPeerSessionImpl
    try {
      session = new LocalPeerSessionImpl(this.id, this.#radioFactory, options, this.#offlineChannel, () => {
        if (this.#session === session) this.#session = undefined
      })
    } catch (error) {
      if (error instanceof LocalPeerError) throw error
      throw new LocalPeerError('transport', error instanceof Error ? error.message : String(error))
    }
    this.#session = session
    try {
      await session.announce()
    } catch (error) {
      session.close()
      throw error
    }
    return session
  }
}

export class LocalPeerSessionImpl implements LocalPeerSession {
  readonly id: string
  readonly service: string
  readonly serviceHash: number
  readonly sharedKey?: string
  readonly displayName?: string
  closed = false
  #radio: LocalPeerRadio
  #onClose: () => void
  #peers = new Map<string, PeerRecord>()
  #subscribers = new Map<string, Set<(message: LocalPeerMessage) => void>>()
  #pending = new Map<number, PendingSend>()
  #discoveryWaits = new Map<TimerHandle, () => void>()
  #reassemblies = new Map<string, ReassemblyRecord>()
  #delivered = new Map<string, number>()

  constructor(
    id: string,
    radioFactory: LocalPeerRadioFactory,
    options: LocalPeerOpenOptions,
    offlineChannel = DEFAULT_OFFLINE_CHANNEL,
    onClose: () => void = () => {},
  ) {
    this.id = id
    this.service = options.service
    this.serviceHash = fnv1a32(options.service)
    this.sharedKey = options.sharedKey
    this.displayName = options.displayName
    this.#onClose = onClose
    this.#radio = radioFactory({
      offlineChannel,
      sharedKey: this.sharedKey,
      onReceive: (event) => this.#handleRadioReceive(event),
    })
    if (this.#radio.id.toUpperCase() !== this.id.toUpperCase()) {
      this.#radio.close()
      throw new LocalPeerError('transport', 'local peer radio identity changed')
    }
  }

  async announce(): Promise<void> {
    this.#assertOpen()
    const payload = encodeUTF8(
      JSON.stringify({ service: this.service, name: this.displayName } satisfies DiscoveryEnvelope),
    )
    const frame = encodeLocalPeerFrame({
      kind: LocalPeerFrameKind.ANNOUNCE,
      flags: LocalPeerFrameFlag.BROADCAST,
      messageId: allocateMessageId(),
      fragmentIndex: 0,
      fragmentCount: 1,
      serviceHash: this.serviceHash,
      payload,
    })
    await this.#sendRadio(undefined, frame)
  }

  async discover(options: { timeoutMs?: number } = {}): Promise<readonly LocalPeerInfo[]> {
    this.#assertOpen()
    const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
      throw new LocalPeerError('invalid-argument', 'timeoutMs must be between 0 and 60000')
    }
    const payload = encodeUTF8(
      JSON.stringify({ service: this.service, name: this.displayName } satisfies DiscoveryEnvelope),
    )
    const frame = encodeLocalPeerFrame({
      kind: LocalPeerFrameKind.DISCOVER,
      flags: LocalPeerFrameFlag.BROADCAST,
      messageId: allocateMessageId(),
      fragmentIndex: 0,
      fragmentCount: 1,
      serviceHash: this.serviceHash,
      payload,
    })
    await this.#sendRadio(undefined, frame)
    this.#assertOpen()
    if (timeoutMs > 0) await this.#waitForDiscovery(timeoutMs)
    this.#assertOpen()
    return Array.from(this.#peers.values(), publicPeer)
  }

  async send(peerId: string, type: string, payload: JsonValue): Promise<LocalPeerDeliveryReceipt> {
    this.#assertOpen()
    validatePeerId(peerId)
    const normalizedPeerId = peerId.toUpperCase()
    if (normalizedPeerId === this.id.toUpperCase()) {
      throw new LocalPeerError('invalid-argument', 'cannot send a point-to-point message to this device')
    }
    const encoded = encodeEnvelope(this.service, type, payload)
    if (!this.#peers.has(normalizedPeerId)) {
      const discovered = await this.discover()
      if (!discovered.some((peer) => peer.id === normalizedPeerId)) {
        throw new LocalPeerError('peer-unavailable', `peer ${normalizedPeerId} is not available on this channel`)
      }
    }
    this.#addPeer(normalizedPeerId)
    const messageId = allocateMessageId()
    const frames = fragmentLocalPeerPayload(
      LocalPeerFrameKind.DATA,
      LocalPeerFrameFlag.RELIABLE,
      messageId,
      this.serviceHash,
      encoded,
    )
    return new Promise<LocalPeerDeliveryReceipt>((resolve, reject) => {
      const pending: PendingSend = { peerId: normalizedPeerId, frames, attempts: 0, resolve, reject }
      this.#pending.set(messageId, pending)
      void this.#transmit(messageId, pending)
    })
  }

  async broadcast(type: string, payload: JsonValue): Promise<LocalPeerBroadcastReceipt> {
    this.#assertOpen()
    const encoded = encodeEnvelope(this.service, type, payload)
    const messageId = allocateMessageId()
    const frames = fragmentLocalPeerPayload(
      LocalPeerFrameKind.DATA,
      LocalPeerFrameFlag.BROADCAST,
      messageId,
      this.serviceHash,
      encoded,
    )
    for (const frame of frames) await this.#sendRadio(undefined, frame)
    return { messageId: formatMessageId(messageId) }
  }

  subscribe(type: string | '*', handler: (message: LocalPeerMessage) => void): () => void {
    this.#assertOpen()
    if (type !== '*') validateMessageType(type)
    if (typeof handler !== 'function') throw new LocalPeerError('invalid-argument', 'handler must be a function')
    let handlers = this.#subscribers.get(type)
    if (!handlers) {
      handlers = new Set()
      this.#subscribers.set(type, handlers)
    }
    handlers.add(handler)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      handlers?.delete(handler)
      if (handlers?.size === 0) this.#subscribers.delete(type)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const [messageId, pending] of this.#pending) {
      if (pending.timer) Timer.clear(pending.timer)
      pending.reject(new LocalPeerError('closed', `message ${formatMessageId(messageId)} was cancelled`))
    }
    this.#pending.clear()
    for (const [timer, finish] of this.#discoveryWaits) {
      Timer.clear(timer)
      finish()
    }
    this.#discoveryWaits.clear()
    for (const reassembly of this.#reassemblies.values()) Timer.clear(reassembly.timer)
    this.#reassemblies.clear()
    this.#delivered.clear()
    this.#subscribers.clear()
    this.#peers.clear()
    try {
      this.#radio.close()
    } catch (error) {
      trace(`[local-peer] close failed: ${String(error)}\n`)
    } finally {
      this.#onClose()
    }
  }

  async #transmit(messageId: number, pending: PendingSend): Promise<void> {
    if (this.closed || this.#pending.get(messageId) !== pending) return
    pending.attempts += 1
    try {
      for (const frame of pending.frames) await this.#sendRadio(pending.peerId, frame)
    } catch (_error) {
      // A transient radio failure follows the same bounded retry policy as a missing ACK.
    }
    if (this.closed || this.#pending.get(messageId) !== pending) return
    pending.timer = Timer.set(() => {
      pending.timer = undefined
      if (this.#pending.get(messageId) !== pending) return
      if (pending.attempts >= MAX_SEND_ATTEMPTS) {
        this.#pending.delete(messageId)
        pending.reject(
          new LocalPeerError(
            'timeout',
            `peer ${pending.peerId} did not acknowledge message ${formatMessageId(messageId)}`,
          ),
        )
      } else {
        void this.#transmit(messageId, pending)
      }
    }, ACK_TIMEOUT_MS)
  }

  async #sendRadio(peerId: string | undefined, frame: ArrayBuffer): Promise<void> {
    this.#assertOpen()
    try {
      await this.#radio.send(peerId, frame)
    } catch (error) {
      if (this.closed) throw new LocalPeerError('closed', 'local peer session is closed')
      throw new LocalPeerError('transport', error instanceof Error ? error.message : String(error))
    }
  }

  #handleRadioReceive(event: LocalPeerRadioReceiveEvent): void {
    if (this.closed) return
    const frame = decodeLocalPeerFrame(event.data)
    if (!frame || frame.serviceHash !== this.serviceHash) return
    const peerId = event.peerId.toUpperCase()
    if (!/^[0-9A-F]{12}$/.test(peerId) || peerId === this.id.toUpperCase()) return
    try {
      switch (frame.kind) {
        case LocalPeerFrameKind.DISCOVER:
        case LocalPeerFrameKind.ANNOUNCE:
          this.#handleDiscovery(peerId, event.secure, frame)
          break
        case LocalPeerFrameKind.ACK:
          this.#handleAcknowledgement(peerId, event.secure, frame)
          break
        case LocalPeerFrameKind.DATA:
          this.#handleData(peerId, event.secure, frame)
          break
      }
    } catch (error) {
      trace(`[local-peer] received frame failed: ${String(error)}\n`)
    }
  }

  #handleDiscovery(peerId: string, _secure: boolean, frame: LocalPeerFrame): void {
    if (frame.flags !== LocalPeerFrameFlag.BROADCAST || frame.fragmentCount !== 1) return
    const envelope = parseObject(frame.payload)
    if (!envelope || envelope.service !== this.service) return
    const name =
      typeof envelope.name === 'string' && encodeUTF8(envelope.name).byteLength <= MAX_NAME_BYTES
        ? envelope.name
        : undefined
    this.#rememberPeer(peerId, name, false)
    this.#addPeer(peerId)
    if (frame.kind === LocalPeerFrameKind.DISCOVER) {
      void this.announce().catch((error) => trace(`[local-peer] announce failed: ${String(error)}\n`))
    }
  }

  #handleAcknowledgement(peerId: string, secure: boolean, frame: LocalPeerFrame): void {
    if (frame.flags !== 0 || frame.fragmentCount !== 1 || frame.payload.byteLength !== 0) return
    const pending = this.#pending.get(frame.messageId)
    if (!pending || pending.peerId !== peerId) return
    if (this.sharedKey !== undefined && !secure) return
    this.#pending.delete(frame.messageId)
    if (pending.timer) Timer.clear(pending.timer)
    this.#rememberPeer(peerId, undefined, secure)
    pending.resolve({ messageId: formatMessageId(frame.messageId), peerId, attempts: pending.attempts })
  }

  #handleData(peerId: string, secure: boolean, frame: LocalPeerFrame): void {
    if (frame.flags !== LocalPeerFrameFlag.RELIABLE && frame.flags !== LocalPeerFrameFlag.BROADCAST) return
    if (frame.fragmentCount > Math.ceil(MAX_MESSAGE_BYTES / LOCAL_PEER_FRAGMENT_BYTES)) return
    const reliable = frame.flags === LocalPeerFrameFlag.RELIABLE
    if (reliable && this.sharedKey !== undefined && !secure) return
    const key = `${peerId}:${frame.messageId}`
    let record = this.#reassemblies.get(key)
    if (!record) {
      this.#evictReassemblyIfNeeded()
      const timer = Timer.set(() => {
        this.#reassemblies.delete(key)
      }, REASSEMBLY_TIMEOUT_MS)
      record = {
        peerId,
        messageId: frame.messageId,
        flags: frame.flags,
        fragmentCount: frame.fragmentCount,
        fragments: new Array(frame.fragmentCount),
        received: 0,
        secure: reliable && secure,
        timer,
        createdAt: Date.now(),
      }
      this.#reassemblies.set(key, record)
    }
    if (
      record.fragmentCount !== frame.fragmentCount ||
      record.flags !== frame.flags ||
      record.secure !== (reliable && secure)
    )
      return
    if (!record.fragments[frame.fragmentIndex]) {
      record.fragments[frame.fragmentIndex] = frame.payload
      record.received += 1
    }
    if (record.received !== record.fragmentCount) return
    Timer.clear(record.timer)
    this.#reassemblies.delete(key)
    const length = record.fragments.reduce((total, fragment) => total + (fragment?.byteLength ?? 0), 0)
    if (length > MAX_MESSAGE_BYTES) return
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const fragment of record.fragments) {
      if (!fragment) return
      bytes.set(fragment, offset)
      offset += fragment.byteLength
    }
    const envelope = parseObject(bytes)
    if (!envelope || envelope.service !== this.service || typeof envelope.type !== 'string' || !('payload' in envelope))
      return
    try {
      validateMessageType(envelope.type)
      validateJsonValue(envelope.payload)
    } catch (_error) {
      return
    }

    this.#rememberPeer(peerId, undefined, reliable && secure)
    const duplicate = this.#wasDelivered(key)
    // Queue the ACK before invoking subscribers. A subscriber may immediately
    // send a reply, and placing that fragmented reply ahead of the ACK can make
    // the sender exhaust its bounded acknowledgement timeout.
    if (reliable) void this.#sendAcknowledgement(peerId, frame.messageId)
    if (!duplicate) {
      this.#deliver({
        id: formatMessageId(frame.messageId),
        peer: publicPeer(this.#peers.get(peerId) as PeerRecord),
        type: envelope.type,
        payload: envelope.payload,
      })
    }
  }

  async #sendAcknowledgement(peerId: string, messageId: number): Promise<void> {
    try {
      this.#addPeer(peerId)
      await this.#sendRadio(
        peerId,
        encodeLocalPeerFrame({
          kind: LocalPeerFrameKind.ACK,
          flags: 0,
          messageId,
          fragmentIndex: 0,
          fragmentCount: 1,
          serviceHash: this.serviceHash,
          payload: new Uint8Array(0),
        }),
      )
    } catch (error) {
      trace(`[local-peer] acknowledgement failed: ${String(error)}\n`)
    }
  }

  #rememberPeer(peerId: string, name: string | undefined, secure: boolean): void {
    const previous = this.#peers.get(peerId)
    const maximumPeers = this.sharedKey === undefined ? MAX_UNSECURED_PEERS : MAX_SECURED_PEERS
    if (!previous && this.#peers.size >= maximumPeers) {
      let oldest: PeerRecord | undefined
      for (const peer of this.#peers.values()) {
        if (!oldest || peer.lastSeen < oldest.lastSeen) oldest = peer
      }
      if (oldest) {
        this.#peers.delete(oldest.id)
        try {
          this.#radio.removePeer(oldest.id)
        } catch (error) {
          trace(`[local-peer] remove peer failed: ${String(error)}\n`)
        }
      }
    }
    this.#peers.set(peerId, {
      id: peerId,
      name: name ?? previous?.name,
      secure: secure || previous?.secure === true,
      lastSeen: Date.now(),
    })
  }

  #addPeer(peerId: string): void {
    try {
      this.#radio.addPeer(peerId, this.sharedKey !== undefined)
    } catch (error) {
      throw new LocalPeerError('transport', error instanceof Error ? error.message : String(error))
    }
  }

  #wasDelivered(key: string): boolean {
    const now = Date.now()
    for (const [deliveredKey, deliveredAt] of this.#delivered) {
      if (now - deliveredAt > DEDUPLICATION_WINDOW_MS) this.#delivered.delete(deliveredKey)
    }
    if (this.#delivered.has(key)) return true
    while (this.#delivered.size >= MAX_DELIVERED_MESSAGES) {
      const oldest = this.#delivered.keys().next().value
      if (oldest === undefined) break
      this.#delivered.delete(oldest)
    }
    this.#delivered.set(key, now)
    return false
  }

  #deliver(message: LocalPeerMessage): void {
    const handlers = [...(this.#subscribers.get(message.type) ?? []), ...(this.#subscribers.get('*') ?? [])]
    for (const handler of handlers) {
      try {
        handler(message)
      } catch (error) {
        trace(`[local-peer] subscriber failed: ${String(error)}\n`)
      }
    }
  }

  #evictReassemblyIfNeeded(): void {
    if (this.#reassemblies.size < MAX_REASSEMBLIES) return
    let oldestKey: string | undefined
    let oldest: ReassemblyRecord | undefined
    for (const [key, record] of this.#reassemblies) {
      if (!oldest || record.createdAt < oldest.createdAt) {
        oldestKey = key
        oldest = record
      }
    }
    if (oldestKey && oldest) {
      Timer.clear(oldest.timer)
      this.#reassemblies.delete(oldestKey)
    }
  }

  #waitForDiscovery(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: TimerHandle
      const finish = () => {
        this.#discoveryWaits.delete(timer)
        resolve()
      }
      timer = Timer.set(finish, timeoutMs)
      this.#discoveryWaits.set(timer, finish)
    })
  }

  #assertOpen(): void {
    if (this.closed) throw new LocalPeerError('closed', 'local peer session is closed')
  }
}
