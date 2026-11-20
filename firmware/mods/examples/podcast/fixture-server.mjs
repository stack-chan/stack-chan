import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

if (!process.argv[2]) throw new Error('Usage: node fixture-server.mjs <episode.mp3> [port]')
const path = resolve(process.argv[2])
const size = statSync(path).size
if (!size) throw new Error('MP3 fixture is empty')
const routes = [
  ['Content-Length', '/audio.mp3'],
  ['Chunked', '/chunked.mp3'],
  ['Relative redirect', '/redirect'],
  ['Truncated (must fail)', '/truncated.mp3'],
]
const server = createServer((request, response) => {
  if (request.url === '/feed.xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Podcast fixtures</title>${routes.map(([title, url]) => `<item><title>${title}</title><guid>${url}</guid><enclosure type="audio/mpeg" url="${url}"/></item>`).join('')}</channel></rss>`
    response.writeHead(200, { 'content-type': 'application/rss+xml', 'content-length': Buffer.byteLength(xml) })
    response.end(xml)
  } else if (request.url === '/redirect') {
    response.writeHead(302, { location: './audio.mp3' })
    response.end()
  } else if (['/audio.mp3', '/chunked.mp3', '/truncated.mp3'].includes(request.url)) {
    const truncated = request.url === '/truncated.mp3'
    const match = /^bytes=(\d+)-$/.exec(request.headers.range ?? '')
    const start = request.url === '/audio.mp3' && match ? Number(match[1]) : 0
    if (start >= size) {
      response.writeHead(416, { 'content-range': `bytes */${size}` })
      response.end()
      return
    }
    response.writeHead(start ? 206 : 200, {
      'content-type': 'audio/mpeg',
      'accept-ranges': request.url === '/audio.mp3' ? 'bytes' : 'none',
      ...(start && { 'content-range': `bytes ${start}-${size - 1}/${size}` }),
      ...(request.url !== '/chunked.mp3' && { 'content-length': size - start }),
    })
    const input = createReadStream(path, truncated ? { end: Math.max(0, Math.floor(size / 2) - 1) } : { start })
    input.on('error', () => response.destroy())
    response.on('close', () => input.destroy())
    if (truncated) {
      input.pipe(response, { end: false })
      input.on('end', () => response.end())
    } else input.pipe(response)
  } else {
    response.writeHead(404)
    response.end()
  }
})
server.listen(Number(process.argv[3] ?? 8080), '0.0.0.0', () => {
  console.log(`Podcast fixture server: http://<LAN IP>:${server.address().port}/feed.xml`)
})
