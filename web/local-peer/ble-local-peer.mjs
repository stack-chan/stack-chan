const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
const BROADCAST_ID = 'FFFFFFFFFFFF'
const RECORD_MAGIC = Uint8Array.of(0x53, 0x4c, 0x42, 0x31)
const FRAME_MAGIC = Uint8Array.of(0x53, 0x4c, 0x50, 0x31)
const RECORD_HEADER_BYTES = 22
const FRAME_HEADER_BYTES = 18
const FRAME_BYTES = 234
const FRAGMENT_BYTES = FRAME_BYTES - FRAME_HEADER_BYTES
const MESSAGE_BYTES = 2048
const MAX_FRAGMENTS = Math.ceil(MESSAGE_BYTES / FRAGMENT_BYTES)
const AUTH_TAG_BYTES = 16
const AUTH_DOMAIN = new TextEncoder().encode('stackchan-local-peer-auth-v1:')
const RecordKind = Object.freeze({ HELLO: 1, DATA: 2 })
const FrameKind = Object.freeze({ DISCOVER: 1, ANNOUNCE: 2, DATA: 3, ACK: 4 })
const FrameFlag = Object.freeze({ RELIABLE: 1, BROADCAST: 2 })

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function idBytes(id) {
  if (!/^[0-9a-f]{12}$/i.test(id)) throw new RangeError('peer ID must contain 12 hexadecimal characters')
  return Uint8Array.from({ length: 6 }, (_, index) => Number.parseInt(id.slice(index * 2, index * 2 + 2), 16))
}

function bytesId(bytes) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function fnv1a32(value) {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

async function authenticationKey(sharedKey, cryptoProvider = globalThis.crypto) {
  return new Uint8Array(
    await cryptoProvider.subtle.digest('SHA-256', concat(AUTH_DOMAIN, new TextEncoder().encode(sharedKey)))
  )
}

async function authenticationTag(key, sourceId, destinationId, payload, cryptoProvider = globalThis.crypto) {
  const imported = await cryptoProvider.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await cryptoProvider.subtle.sign(
    'HMAC',
    imported,
    concat(idBytes(sourceId), idBytes(destinationId), payload)
  )
  return new Uint8Array(signature).subarray(0, AUTH_TAG_BYTES)
}

function tagsEqual(actual, expected) {
  if (actual.byteLength !== expected.byteLength) return false
  let difference = 0
  for (let index = 0; index < actual.byteLength; index += 1) difference |= actual[index] ^ expected[index]
  return difference === 0
}

export async function encodeBLELocalPeerRecord(record, key, cryptoProvider = globalThis.crypto) {
  const authenticated = record.authenticated === true
  const tag = authenticated
    ? await authenticationTag(key, record.sourceId, record.destinationId, record.payload, cryptoProvider)
    : new Uint8Array(0)
  const bytes = new Uint8Array(RECORD_HEADER_BYTES + record.payload.byteLength + tag.byteLength)
  bytes.set(RECORD_MAGIC)
  bytes[4] = 1
  bytes[5] = record.kind
  bytes[6] = authenticated ? 1 : 0
  bytes.set(idBytes(record.sourceId), 8)
  bytes.set(idBytes(record.destinationId), 14)
  new DataView(bytes.buffer).setUint16(20, record.payload.byteLength)
  bytes.set(record.payload, RECORD_HEADER_BYTES)
  bytes.set(tag, RECORD_HEADER_BYTES + record.payload.byteLength)
  return bytes
}

export class BLELocalPeerRecordDecoder {
  #buffer = new Uint8Array(0)

  push(value) {
    this.#buffer = concat(this.#buffer, value instanceof Uint8Array ? value : new Uint8Array(value))
    const records = []
    for (;;) {
      let start = 0
      while (
        start + 4 <= this.#buffer.byteLength &&
        !RECORD_MAGIC.every((byte, index) => this.#buffer[start + index] === byte)
      )
        start += 1
      if (start) this.#buffer = this.#buffer.subarray(start)
      if (this.#buffer.byteLength < RECORD_HEADER_BYTES) break
      const payloadLength = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength
      ).getUint16(20)
      const authenticated = this.#buffer[6] === 1
      if (
        this.#buffer[4] !== 1 ||
        ![RecordKind.HELLO, RecordKind.DATA].includes(this.#buffer[5]) ||
        (this.#buffer[6] & ~1) !== 0 ||
        payloadLength > FRAME_BYTES
      ) {
        this.#buffer = this.#buffer.subarray(1)
        continue
      }
      const length = RECORD_HEADER_BYTES + payloadLength + (authenticated ? AUTH_TAG_BYTES : 0)
      if (this.#buffer.byteLength < length) break
      records.push({
        kind: this.#buffer[5],
        authenticated,
        sourceId: bytesId(this.#buffer.subarray(8, 14)),
        destinationId: bytesId(this.#buffer.subarray(14, 20)),
        payload: this.#buffer.slice(RECORD_HEADER_BYTES, RECORD_HEADER_BYTES + payloadLength),
        tag: authenticated ? this.#buffer.slice(RECORD_HEADER_BYTES + payloadLength, length) : undefined,
      })
      this.#buffer = this.#buffer.subarray(length)
    }
    return records
  }

  reset() {
    this.#buffer = new Uint8Array(0)
  }
}

function encodeFrame({ kind, flags, messageId, fragmentIndex = 0, fragmentCount = 1, serviceHash, payload }) {
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  bytes.set(FRAME_MAGIC)
  bytes[4] = kind
  bytes[5] = flags
  const view = new DataView(bytes.buffer)
  view.setUint32(6, messageId)
  bytes[10] = fragmentIndex
  bytes[11] = fragmentCount
  view.setUint32(12, serviceHash)
  view.setUint16(16, payload.byteLength)
  bytes.set(payload, FRAME_HEADER_BYTES)
  return bytes
}

function decodeFrame(bytes) {
  if (bytes.byteLength < FRAME_HEADER_BYTES || bytes.byteLength > FRAME_BYTES) return undefined
  if (!FRAME_MAGIC.every((value, index) => bytes[index] === value)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fragmentIndex = bytes[10]
  const fragmentCount = bytes[11]
  const payloadLength = view.getUint16(16)
  if (fragmentCount < 1 || fragmentIndex >= fragmentCount || FRAME_HEADER_BYTES + payloadLength !== bytes.byteLength)
    return undefined
  return {
    kind: bytes[4],
    flags: bytes[5],
    messageId: view.getUint32(6),
    fragmentIndex,
    fragmentCount,
    serviceHash: view.getUint32(12),
    payload: bytes.slice(FRAME_HEADER_BYTES),
  }
}

function fragments(kind, flags, messageId, serviceHash, payload) {
  const count = Math.max(1, Math.ceil(payload.byteLength / FRAGMENT_BYTES))
  return Array.from({ length: count }, (_, index) =>
    encodeFrame({
      kind,
      flags,
      messageId,
      fragmentIndex: index,
      fragmentCount: count,
      serviceHash,
      payload: payload.subarray(index * FRAGMENT_BYTES, (index + 1) * FRAGMENT_BYTES),
    })
  )
}

function randomId(cryptoProvider) {
  const bytes = new Uint8Array(6)
  cryptoProvider.getRandomValues(bytes)
  bytes[0] &= 0xfe
  bytes[0] |= 0x02
  return bytesId(bytes)
}

function messageId(cryptoProvider) {
  const values = new Uint32Array(1)
  cryptoProvider.getRandomValues(values)
  return values[0] || 1
}

export class BLELocalPeerCapability {
  #bluetooth
  #crypto
  #session
  id

  constructor({
    bluetooth = globalThis.navigator?.bluetooth,
    crypto = globalThis.crypto,
    storage = globalThis.localStorage,
  } = {}) {
    if (!bluetooth) throw new Error('Web Bluetooth is not available')
    this.#bluetooth = bluetooth
    this.#crypto = crypto
    const stored = storage?.getItem('stackchan.localPeer.id')
    this.id = /^[0-9a-f]{12}$/i.test(stored ?? '') ? stored.toUpperCase() : randomId(crypto)
    storage?.setItem('stackchan.localPeer.id', this.id)
  }

  async open(options) {
    if (this.#session && !this.#session.closed) throw new Error('a local peer session is already open')
    if (options.transport !== undefined && options.transport !== 'ble') throw new Error('Web client supports only BLE')
    const session = new BLELocalPeerSession(this.id, options, this.#bluetooth, this.#crypto, () => {
      if (this.#session === session) this.#session = undefined
    })
    this.#session = session
    try {
      await session.connect()
      return session
    } catch (error) {
      session.close()
      throw error
    }
  }
}

class BLELocalPeerSession {
  #id
  #options
  #bluetooth
  #crypto
  #onClose
  #device
  #rx
  #tx
  #decoder = new BLELocalPeerRecordDecoder()
  #remoteId
  #remoteName
  #serviceHash
  #key
  #subscribers = new Map()
  #pending = new Map()
  #reassemblies = new Map()
  #delivered = new Map()
  #remoteSecure = false
  closed = false

  constructor(id, options, bluetooth, cryptoProvider, onClose) {
    const serviceBytes = typeof options?.service === 'string' ? new TextEncoder().encode(options.service).byteLength : 0
    if (serviceBytes < 1 || serviceBytes > 64) throw new TypeError('service must contain 1-64 UTF-8 bytes')
    this.#id = id
    this.#options = options
    this.#bluetooth = bluetooth
    this.#crypto = cryptoProvider
    this.#onClose = onClose
    this.#serviceHash = fnv1a32(options.service)
  }

  async connect() {
    this.#key = this.#options.sharedKey ? await authenticationKey(this.#options.sharedKey, this.#crypto) : undefined
    this.#device = await this.#bluetooth.requestDevice({
      filters: [{ namePrefix: 'STK-LP-' }],
      optionalServices: [SERVICE_UUID],
    })
    this.#device.addEventListener('gattserverdisconnected', () => this.close())
    const server = await this.#device.gatt.connect()
    const service = await server.getPrimaryService(SERVICE_UUID)
    this.#rx = await service.getCharacteristic(RX_UUID)
    this.#tx = await service.getCharacteristic(TX_UUID)
    this.#tx.addEventListener('characteristicvaluechanged', (event) => {
      void this.#receive(
        new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength)
      )
    })
    await this.#tx.startNotifications()
    await this.#writeRecord(RecordKind.HELLO, BROADCAST_ID, new Uint8Array(0), false)
    await this.#announce()
  }

  async discover({ timeoutMs = 750 } = {}) {
    this.#assertOpen()
    await this.#sendDiscovery(FrameKind.DISCOVER)
    if (timeoutMs > 0) await new Promise((resolve) => setTimeout(resolve, timeoutMs))
    this.#assertOpen()
    return this.#remoteId ? [{ id: this.#remoteId, name: this.#remoteName, secure: this.#remoteSecure }] : []
  }

  async send(peerId, type, payload) {
    this.#assertOpen()
    if (peerId !== this.#remoteId) {
      await this.discover()
      if (peerId !== this.#remoteId) throw new Error(`peer ${peerId} is unavailable`)
    }
    const encoded = new TextEncoder().encode(JSON.stringify({ service: this.#options.service, type, payload }))
    if (encoded.byteLength > MESSAGE_BYTES) throw new RangeError('encoded message exceeds 2048 bytes')
    const id = messageId(this.#crypto)
    const frames = fragments(FrameKind.DATA, FrameFlag.RELIABLE, id, this.#serviceHash, encoded)
    return new Promise((resolve, reject) => {
      const pending = { peerId, frames, attempts: 0, resolve, reject }
      this.#pending.set(id, pending)
      void this.#transmit(id, pending)
    })
  }

  async broadcast(type, payload) {
    this.#assertOpen()
    const encoded = new TextEncoder().encode(JSON.stringify({ service: this.#options.service, type, payload }))
    if (encoded.byteLength > MESSAGE_BYTES) throw new RangeError('encoded message exceeds 2048 bytes')
    const id = messageId(this.#crypto)
    for (const frame of fragments(FrameKind.DATA, FrameFlag.BROADCAST, id, this.#serviceHash, encoded)) {
      await this.#sendFrame(undefined, frame)
    }
    return { messageId: id.toString(16).padStart(8, '0') }
  }

  subscribe(type, handler) {
    this.#assertOpen()
    const handlers = this.#subscribers.get(type) ?? new Set()
    handlers.add(handler)
    this.#subscribers.set(type, handlers)
    return () => handlers.delete(handler)
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('local peer session is closed'))
    }
    this.#pending.clear()
    for (const record of this.#reassemblies.values()) clearTimeout(record.timer)
    this.#reassemblies.clear()
    this.#delivered.clear()
    this.#device?.gatt?.disconnect()
    this.#onClose()
  }

  async #announce() {
    await this.#sendDiscovery(FrameKind.ANNOUNCE)
  }

  async #sendDiscovery(kind) {
    const payload = new TextEncoder().encode(
      JSON.stringify({ service: this.#options.service, name: this.#options.displayName })
    )
    await this.#sendFrame(
      undefined,
      encodeFrame({
        kind,
        flags: FrameFlag.BROADCAST,
        messageId: messageId(this.#crypto),
        serviceHash: this.#serviceHash,
        payload,
      })
    )
  }

  async #transmit(id, pending) {
    if (this.closed || this.#pending.get(id) !== pending) return
    pending.attempts += 1
    try {
      for (const frame of pending.frames) await this.#sendFrame(pending.peerId, frame)
    } catch {}
    pending.timer = setTimeout(() => {
      if (this.#pending.get(id) !== pending) return
      if (pending.attempts >= 3) {
        this.#pending.delete(id)
        pending.reject(new Error(`peer ${pending.peerId} did not acknowledge message`))
      } else void this.#transmit(id, pending)
    }, 250)
  }

  async #sendFrame(peerId, frame) {
    await this.#writeRecord(RecordKind.DATA, peerId ?? BROADCAST_ID, frame, peerId !== undefined && !!this.#key)
  }

  async #writeRecord(kind, destinationId, payload, authenticated) {
    const record = await encodeBLELocalPeerRecord(
      { kind, authenticated, sourceId: this.#id, destinationId, payload },
      this.#key,
      this.#crypto
    )
    for (let offset = 0; offset < record.byteLength; offset += 20) {
      const chunk = record.slice(offset, offset + 20)
      if (this.#rx.writeValueWithResponse) await this.#rx.writeValueWithResponse(chunk)
      else await this.#rx.writeValue(chunk)
    }
  }

  async #receive(chunk) {
    for (const record of this.#decoder.push(chunk)) {
      if (record.kind === RecordKind.HELLO) {
        if (!record.authenticated && record.destinationId === BROADCAST_ID) this.#remoteId = record.sourceId
        continue
      }
      if (record.kind !== RecordKind.DATA || record.sourceId !== this.#remoteId) continue
      const broadcast = record.destinationId === BROADCAST_ID
      if (!broadcast && record.destinationId !== this.#id) continue
      let secure = false
      if (!broadcast && this.#key) {
        if (!record.authenticated || !record.tag) continue
        const expected = await authenticationTag(
          this.#key,
          record.sourceId,
          record.destinationId,
          record.payload,
          this.#crypto
        )
        if (!tagsEqual(record.tag, expected)) continue
        secure = true
        this.#remoteSecure = true
      } else if (record.authenticated) continue
      await this.#handleFrame(record.sourceId, record.payload, secure)
    }
  }

  async #handleFrame(peerId, bytes, secure) {
    const frame = decodeFrame(bytes)
    if (!frame || frame.serviceHash !== this.#serviceHash) return
    if (frame.kind === FrameKind.DISCOVER || frame.kind === FrameKind.ANNOUNCE) {
      try {
        const envelope = JSON.parse(new TextDecoder().decode(frame.payload))
        if (envelope.service !== this.#options.service) return
        this.#remoteName = typeof envelope.name === 'string' ? envelope.name : undefined
        if (frame.kind === FrameKind.DISCOVER) void this.#announce()
      } catch {}
      return
    }
    if (frame.kind === FrameKind.ACK) {
      const pending = this.#pending.get(frame.messageId)
      if (!pending || pending.peerId !== peerId || (this.#key && !secure)) return
      this.#pending.delete(frame.messageId)
      clearTimeout(pending.timer)
      pending.resolve({ messageId: frame.messageId.toString(16).padStart(8, '0'), peerId, attempts: pending.attempts })
      return
    }
    if (frame.kind !== FrameKind.DATA) return
    if (
      frame.fragmentCount > MAX_FRAGMENTS ||
      (frame.flags !== FrameFlag.RELIABLE && frame.flags !== FrameFlag.BROADCAST) ||
      (frame.flags === FrameFlag.RELIABLE && this.#key && !secure)
    )
      return
    const key = `${peerId}:${frame.messageId}`
    let record = this.#reassemblies.get(key)
    if (!record) {
      record = {
        flags: frame.flags,
        fragments: new Array(frame.fragmentCount),
        received: 0,
        secure,
        timer: setTimeout(() => this.#reassemblies.delete(key), 2000),
      }
      this.#reassemblies.set(key, record)
    }
    if (record.flags !== frame.flags || record.fragments.length !== frame.fragmentCount || record.secure !== secure)
      return
    if (!record.fragments[frame.fragmentIndex]) {
      record.fragments[frame.fragmentIndex] = frame.payload
      record.received += 1
    }
    if (record.received !== record.fragments.length) return
    clearTimeout(record.timer)
    this.#reassemblies.delete(key)
    const payload = concat(...record.fragments)
    if (payload.byteLength > MESSAGE_BYTES) return
    if (frame.flags === FrameFlag.RELIABLE) {
      await this.#sendFrame(
        peerId,
        encodeFrame({
          kind: FrameKind.ACK,
          flags: 0,
          messageId: frame.messageId,
          serviceHash: this.#serviceHash,
          payload: new Uint8Array(0),
        })
      )
    }
    const now = Date.now()
    for (const [deliveredKey, deliveredAt] of this.#delivered) {
      if (now - deliveredAt > 30_000) this.#delivered.delete(deliveredKey)
    }
    if (this.#delivered.has(key)) return
    this.#delivered.set(key, now)
    try {
      const envelope = JSON.parse(new TextDecoder().decode(payload))
      if (envelope.service !== this.#options.service || typeof envelope.type !== 'string') return
      const message = {
        id: frame.messageId.toString(16).padStart(8, '0'),
        peer: { id: peerId, name: this.#remoteName, secure: record.secure },
        type: envelope.type,
        payload: envelope.payload,
      }
      for (const handler of this.#subscribers.get(message.type) ?? []) handler(message)
      for (const handler of this.#subscribers.get('*') ?? []) handler(message)
    } catch {}
  }

  #assertOpen() {
    if (this.closed) throw new Error('local peer session is closed')
  }
}

export default BLELocalPeerCapability
