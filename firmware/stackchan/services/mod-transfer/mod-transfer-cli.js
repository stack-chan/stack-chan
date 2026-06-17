import CLI from 'cli'
import Console from 'console'
import Flash from 'flash'

const RESPONSE_PREFIX = 'MODX '
const MAX_CHUNK_SIZE = 384
const PARTITION_NAME = 'xs'

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let value = i
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  crcTable[i] = value >>> 0
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function respond(context, message) {
  context.line(`${RESPONSE_PREFIX}${JSON.stringify(message)}`)
}

function fail(context, code, message) {
  respond(context, { type: 'error', code, message })
}

function openArchive(context) {
  try {
    return new Flash(PARTITION_NAME)
  } catch (error) {
    fail(context, 'no-xs-partition', String(error?.message ?? error))
    return undefined
  }
}

function sectorCount(size, blockSize) {
  return Math.ceil(size / blockSize)
}

let state = undefined

function resetState() {
  state = undefined
}

function handleHello(context, message) {
  const archive = openArchive(context)
  if (!archive) return
  respond(context, {
    type: 'ready',
    partitionName: PARTITION_NAME,
    partitionSize: archive.byteLength,
    eraseBlockSize: archive.blockSize,
    maxChunkSize: MAX_CHUNK_SIZE,
    requestedSize: message.size,
  })
}

function handleStart(context, message) {
  const archive = openArchive(context)
  if (!archive) return
  const size = message.size | 0
  if (size <= 0 || size > archive.byteLength) {
    fail(context, 'invalid-size', `archive size ${size} exceeds ${archive.byteLength}`)
    return
  }

  const sectors = sectorCount(size, archive.blockSize)
  try {
    for (let sector = 0; sector < sectors; sector += 1) archive.erase(sector)
  } catch (error) {
    resetState()
    fail(context, 'erase-failed', String(error?.message ?? error))
    return
  }

  state = {
    archive,
    size,
    crc32: String(message.crc32 ?? ''),
    nextOffset: 0,
    nextSeq: 0,
  }
  respond(context, { type: 'erased', sectors, blockSize: archive.blockSize })
}

function handleChunk(context, message) {
  if (!state) {
    fail(context, 'not-started', 'send start before chunk')
    return
  }

  const seq = message.seq | 0
  const offset = message.offset | 0
  if (seq !== state.nextSeq || offset !== state.nextOffset) {
    fail(context, 'unexpected-chunk', `expected seq ${state.nextSeq} offset ${state.nextOffset}`)
    return
  }

  const bytes = Uint8Array.fromBase64(String(message.data ?? ''))
  if (bytes.byteLength > MAX_CHUNK_SIZE || offset + bytes.byteLength > state.size) {
    fail(context, 'invalid-chunk-size', `chunk length ${bytes.byteLength} at ${offset} is outside archive`)
    return
  }
  const chunkCrc = crc32(bytes)
  if (chunkCrc !== String(message.crc32 ?? '')) {
    fail(context, 'crc-mismatch', `chunk ${seq} crc32 ${chunkCrc} did not match`)
    return
  }

  try {
    state.archive.write(offset, bytes.byteLength, bytes.buffer)
  } catch (error) {
    fail(context, 'write-failed', String(error?.message ?? error))
    return
  }

  state.nextOffset += bytes.byteLength
  state.nextSeq += 1
  respond(context, { type: 'ack', seq, offset, bytes: bytes.byteLength })
}

function handleCommit(context, message) {
  if (!state) {
    fail(context, 'not-started', 'send start before commit')
    return
  }
  if (state.nextOffset !== state.size || state.size !== (message.size | 0)) {
    fail(context, 'incomplete', `received ${state.nextOffset} of ${state.size}`)
    return
  }

  const written = new Uint8Array(state.archive.read(0, state.size))
  const writtenCrc = crc32(written)
  if (writtenCrc !== state.crc32 || writtenCrc !== String(message.crc32 ?? '')) {
    resetState()
    fail(context, 'commit-crc-mismatch', `written crc32 ${writtenCrc} did not match`)
    return
  }

  const size = state.size
  resetState()
  respond(context, { type: 'done', partitionName: PARTITION_NAME, size, crc32: writtenCrc, restartRequired: true })
}

CLI.install(function (command, parts) {
  if (command === 'help') {
    this.line('modrx <json> - receive a MOD .xsa archive into the xs partition')
    return false
  }
  if (command !== 'modrx') return false

  try {
    const message = JSON.parse(parts.join(''))
    switch (message.type) {
      case 'hello':
        handleHello(this, message)
        break
      case 'start':
        handleStart(this, message)
        break
      case 'chunk':
        handleChunk(this, message)
        break
      case 'commit':
        handleCommit(this, message)
        break
      case 'abort':
        resetState()
        respond(this, { type: 'aborted' })
        break
      default:
        fail(this, 'unknown-message', `unknown modrx type ${message.type}`)
        break
    }
  } catch (error) {
    fail(this, 'bad-command', String(error?.message ?? error))
  }
  return true
})

const modTransferConsole = new Console()
void modTransferConsole
