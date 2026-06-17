export function createWebSerialTransportDescriptor() {
  return {
    id: 'web-serial',
    label: 'Web Serial',
    requiresUserGesture: true,
    preferredChunkSize: 1024,
    capabilities: ['full-duplex-byte-stream', 'disconnect-events'],
  }
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
