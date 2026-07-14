import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8080)
const totalBytes = 1024 * 1024 * 1024
const chunk = Buffer.alloc(64 * 1024, 0xa5)

const server = createServer((request, response) => {
  if (request.url !== '/throughput.bin') {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found\n')
    return
  }

  const peer = `${request.socket.remoteAddress}:${request.socket.remotePort}`
  const startedAt = Date.now()
  console.log(`[http-throughput-server] connected peer=${peer}`)
  response.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': totalBytes,
    'content-type': 'application/octet-stream',
  })

  let sent = 0
  let closed = false
  response.on('close', () => {
    closed = true
    const elapsed = Math.max(1, Date.now() - startedAt)
    const average = Math.floor((sent / elapsed) * 1000)
    console.log(
      `[http-throughput-server] closed peer=${peer} elapsed=${elapsed}ms queued=${sent} average=${average}B/s`,
    )
  })

  function write() {
    if (closed) return
    while (sent < totalBytes) {
      const use = Math.min(chunk.byteLength, totalBytes - sent)
      if (!response.write(use === chunk.byteLength ? chunk : chunk.subarray(0, use))) {
        sent += use
        response.once('drain', write)
        return
      }
      sent += use
    }
    response.end()
  }

  write()
})

server.listen(port, '0.0.0.0', () => {
  console.log(`[http-throughput-server] listening address=0.0.0.0 port=${port}`)
})
