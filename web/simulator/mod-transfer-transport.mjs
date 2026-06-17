import { decodeConsoleResponseLine } from './mod-transfer-line-protocol.mjs'

export function createWebSerialTransportDescriptor() {
  return {
    id: 'web-serial',
    label: 'Web Serial',
    requiresUserGesture: true,
    preferredChunkSize: 1024,
    capabilities: ['full-duplex-byte-stream', 'disconnect-events'],
  }
}

export function createBleSerialTransportDescriptor({ serviceUuid = 'stackchan-mod-transfer' } = {}) {
  return {
    id: 'ble-serial',
    label: 'BLE Serial',
    requiresUserGesture: true,
    preferredChunkSize: 160,
    serviceUuid,
    capabilities: ['gatt-characteristics', 'rx-notifications', 'fragmented-writes'],
  }
}

export function createWebSerialLineTransport({ serial = globalThis.navigator?.serial, baudRate = 115200 } = {}) {
  let port
  let reader
  let writer
  let readBuffer = ''
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  return {
    async open() {
      if (!serial?.requestPort) throw new Error('Web Serial is not available in this browser')
      port = await serial.requestPort()
      await port.open({ baudRate })
      reader = port.readable.getReader()
      writer = port.writable.getWriter()
    },
    async writeLine(line) {
      if (!writer) throw new Error('serial port is not open')
      await writer.write(encoder.encode(line))
    },
    async readLine() {
      if (!reader) throw new Error('serial port is not open')
      while (true) {
        const newlineIndex = readBuffer.search(/[\r\n]/)
        if (newlineIndex >= 0) {
          const line = readBuffer.slice(0, newlineIndex)
          readBuffer = readBuffer.slice(newlineIndex + 1).replace(/^[\r\n]+/, '')
          if (decodeConsoleResponseLine(line)) return line
          continue
        }
        const { value, done } = await reader.read()
        if (done) return null
        readBuffer += decoder.decode(value, { stream: true })
      }
    },
    async close() {
      try {
        await reader?.releaseLock?.()
      } catch {}
      try {
        await writer?.releaseLock?.()
      } catch {}
      await port?.close?.()
      port = undefined
      reader = undefined
      writer = undefined
      readBuffer = ''
    },
  }
}

export function fragmentBlePayload(payload, maxWriteSize) {
  if (!Number.isInteger(maxWriteSize) || maxWriteSize <= 0) throw new Error('maxWriteSize must be positive')
  const bytes = normalizeChunk(payload)
  const fragments = []
  for (let offset = 0; offset < bytes.byteLength; offset += maxWriteSize) {
    fragments.push(bytes.slice(offset, offset + maxWriteSize))
  }
  return fragments
}

function normalizeChunk(chunk) {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk)
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return new Uint8Array(chunk ?? [])
}

export function createMockByteTransport({ id = 'mock', incoming = [] } = {}) {
  const incomingQueue = incoming.map(normalizeChunk)
  const transport = {
    id,
    isOpen: false,
    written: [],
    async open() {
      transport.isOpen = true
      return transport
    },
    async write(chunk) {
      if (!transport.isOpen) throw new Error(`${id} transport is not open`)
      transport.written.push(normalizeChunk(chunk))
    },
    async read() {
      if (!transport.isOpen) throw new Error(`${id} transport is not open`)
      return incomingQueue.shift() ?? null
    },
    async close() {
      transport.isOpen = false
    },
  }
  return transport
}
