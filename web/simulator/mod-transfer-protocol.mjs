function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes)
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Uint8Array(bytes ?? [])
}

function encodeMessage(message) {
  return new TextEncoder().encode(JSON.stringify(message))
}

function decodeMessage(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function createTransferPlan({ artifactName, artifactBytes, sha256, requestedChunkSize, deviceMaxChunkSize }) {
  const bytes = normalizeBytes(artifactBytes)
  const chunkSize = Math.max(1, Math.min(requestedChunkSize, deviceMaxChunkSize))
  const chunks = []
  for (let offset = 0, sequence = 0; offset < bytes.byteLength; offset += chunkSize, sequence += 1) {
    chunks.push({ sequence, offset, bytes: bytes.slice(offset, offset + chunkSize) })
  }
  return { artifactName, artifactBytes: bytes, sha256, chunkSize, chunks }
}

export async function runMockModTransfer({ transport, artifactName, artifactBytes, sha256, requestedChunkSize }) {
  const events = []
  let retries = 0

  await transport.open()
  await transport.write(encodeMessage(['hello', { artifactName, size: artifactBytes.byteLength, sha256 }]))
  events.push({ type: 'hello' })

  const ready = decodeMessage(await transport.read())
  if (ready[0] !== 'ready') throw new Error(`expected ready, got ${ready[0]}`)
  const plan = createTransferPlan({ artifactName, artifactBytes, sha256, requestedChunkSize, deviceMaxChunkSize: ready[1] })
  events.push({ type: 'ready', chunkSize: plan.chunkSize })

  for (const chunk of plan.chunks) {
    let acknowledged = false
    while (!acknowledged) {
      await transport.write(encodeMessage(['chunk', chunk.sequence, chunk.offset, Array.from(chunk.bytes)]))
      events.push({ type: 'chunk', sequence: chunk.sequence })
      const response = decodeMessage(await transport.read())
      if (response[0] === 'ack' && response[1] === chunk.sequence) {
        events.push({ type: 'ack', sequence: chunk.sequence })
        acknowledged = true
      } else if (response[0] === 'nack' && response[1] === chunk.sequence) {
        events.push({ type: 'nack', sequence: chunk.sequence })
        retries += 1
      } else {
        throw new Error(`unexpected transfer response: ${JSON.stringify(response)}`)
      }
    }
  }

  await transport.write(encodeMessage(['commit', { size: artifactBytes.byteLength, sha256 }]))
  events.push({ type: 'commit' })
  const done = decodeMessage(await transport.read())
  if (done[0] !== 'ack' || done[1] !== 'commit') throw new Error('commit was not acknowledged')
  events.push({ type: 'done' })
  await transport.close()

  return { status: 'done', retries, events }
}
