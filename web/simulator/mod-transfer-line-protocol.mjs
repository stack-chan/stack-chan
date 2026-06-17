const RESPONSE_PREFIX = 'MODX '

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes)
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Uint8Array(bytes ?? [])
}

function bytesToBase64(bytes) {
  const normalized = normalizeBytes(bytes)
  if (typeof Buffer !== 'undefined') return Buffer.from(normalized).toString('base64')
  let binary = ''
  for (const byte of normalized) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < CRC32_TABLE.length; i += 1) {
  let value = i
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC32_TABLE[i] = value >>> 0
}

export function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of normalizeBytes(bytes)) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

export function encodeConsoleCommandLine(message) {
  return `modrx ${JSON.stringify(message)}\r\n`
}

export function decodeConsoleResponseLine(line) {
  if (typeof line !== 'string') return undefined
  const trimmed = line.trim()
  if (!trimmed.startsWith(RESPONSE_PREFIX)) return undefined
  return JSON.parse(trimmed.slice(RESPONSE_PREFIX.length))
}

async function readResponse(transport, expectedType) {
  while (true) {
    const line = await transport.readLine()
    if (line == null) throw new Error(`serial connection closed while waiting for ${expectedType}`)
    const response = decodeConsoleResponseLine(line)
    if (!response) continue
    if (response.type === 'error') throw new Error(response.message ?? response.code ?? 'device reported an error')
    if (response.type === expectedType) return response
    throw new Error(`expected ${expectedType}, got ${response.type}`)
  }
}

export function createConsoleModTransferSession({ transport, chunkSize = 384 } = {}) {
  if (!transport) throw new Error('transport is required')

  return {
    async transfer({ name = 'mod.xsa', bytes }) {
      const artifactBytes = normalizeBytes(bytes)
      const archiveCrc32 = crc32(artifactBytes)
      await transport.open?.()
      try {
        await transport.writeLine(encodeConsoleCommandLine({ type: 'hello', name, size: artifactBytes.byteLength, crc32: archiveCrc32 }))
        const ready = await readResponse(transport, 'ready')
        if (ready.partitionSize < artifactBytes.byteLength) {
          throw new Error(`MOD archive ${artifactBytes.byteLength} bytes exceeds device xs partition ${ready.partitionSize} bytes`)
        }
        const actualChunkSize = Math.max(1, Math.min(chunkSize, ready.maxChunkSize ?? chunkSize))
        await transport.writeLine(encodeConsoleCommandLine({ type: 'start', size: artifactBytes.byteLength, crc32: archiveCrc32 }))
        await readResponse(transport, 'erased')

        for (let offset = 0, seq = 0; offset < artifactBytes.byteLength; offset += actualChunkSize, seq += 1) {
          const chunk = artifactBytes.slice(offset, offset + actualChunkSize)
          await transport.writeLine(
            encodeConsoleCommandLine({ type: 'chunk', seq, offset, data: bytesToBase64(chunk), crc32: crc32(chunk) })
          )
          const ack = await readResponse(transport, 'ack')
          if (ack.seq !== seq || ack.offset !== offset) throw new Error(`unexpected ack ${JSON.stringify(ack)}`)
        }

        await transport.writeLine(encodeConsoleCommandLine({ type: 'commit', size: artifactBytes.byteLength, crc32: archiveCrc32 }))
        const done = await readResponse(transport, 'done')
        return { status: 'done', ...done }
      } finally {
        await transport.close?.()
      }
    },
  }
}
