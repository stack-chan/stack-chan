import TCP from 'embedded:io/socket/tcp'
import { HttpServerService } from 'http-server-service'
import { MCPServerService } from 'mcp-server'
import { equal } from 'testing/assert'
import Timer from 'timer'

const app = new HttpServerService({ port: 18082 })
app.post('/echo', async (c) => c.json({ query: c.req.query('q'), body: await c.req.text() }))
app.get('/fail', () => {
  throw new Error('route failed')
})
app.get('/empty', (c) => c.text(''))
app.get('/large', (c) => c.text('response-'.repeat(8192)))
let routedLimitedRequests = 0
const limited = new HttpServerService({ port: 18084, maxRequestBodyBytes: 8 })
limited.post('/echo', async (c) => {
  routedLimitedRequests++
  return c.text(await c.req.text())
})
const mcp = new MCPServerService({ port: 18083, token: 'test-token' })

async function exchange(port, cases) {
  return new Promise((resolve, reject) => {
    let index = 0
    let received = ''
    let pending
    let writable = 0
    let socket
    function send() {
      if (!pending || writable < pending.byteLength) return
      const packet = pending
      pending = undefined
      writable = socket.write(packet)
    }
    function prepare() {
      const { path, body = '', token } = cases[index]
      const method = body ? 'POST' : 'GET'
      pending = ArrayBuffer.fromString(
        `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n${token ? `Authorization: Bearer ${token}\r\n` : ''}\r\n${body}`,
      )
      send()
    }
    socket = new TCP({
      address: '127.0.0.1',
      port,
      onWritable(count) {
        writable = count
        send()
      },
      onReadable(count) {
        try {
          received += String.fromArrayBuffer(this.read(count))
          const end = received.indexOf('\r\n\r\n')
          if (end < 0) return
          const header = received.slice(0, end).toLowerCase()
          const length = Number(/content-length: (\d+)/.exec(header)?.[1])
          if (!Number.isFinite(length)) throw new Error('missing content length')
          if (received.length < end + 4 + length) return
          const body = received.slice(end + 4, end + 4 + length)
          equal(Number(header.split(' ')[1]), cases[index].status, `response ${index} status`)
          if (cases[index].check) cases[index].check(body)
          received = received.slice(end + 4 + length)
          if (++index === cases.length) {
            this.close()
            resolve()
            return
          }
          equal(header.includes('connection: close'), false, 'connection must remain reusable')
          prepare()
        } catch (error) {
          this.close()
          reject(error)
        }
      },
      onError() {
        reject(new Error(`TCP failure at request ${index}`))
      },
    })
    prepare()
  })
}
// Send separately timed chunks so no individual read exceeds the limit.
async function rejectOversizedBody() {
  return new Promise((resolve, reject) => {
    let timer
    let started = false
    let chunks = 0
    new TCP({
      address: '127.0.0.1',
      port: 18084,
      onWritable() {
        if (started) return
        started = true
        this.write(ArrayBuffer.fromString('POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: 12\r\n\r\n'))
        timer = Timer.repeat(() => {
          if (chunks === 3) return
          chunks++
          this.write(ArrayBuffer.fromString('abcd'))
        }, 25)
      },
      onReadable(count) {
        this.read(count)
        Timer.clear(timer)
        this.close()
        reject(new Error('Oversized body must be rejected before routing'))
      },
      onError() {
        Timer.clear(timer)
        this.close()
        equal(chunks, 3, 'connection closes only after the cumulative limit is exceeded')
        resolve()
      },
    })
  })
}
try {
  await exchange(18082, [
    {
      path: '/echo?q=first',
      body: 'alpha',
      status: 200,
      check(body) {
        const value = JSON.parse(body)
        equal(value.query, 'first')
        equal(value.body, 'alpha')
      },
    },
    {
      path: '/echo?q=second',
      body: 'a different body',
      status: 200,
      check(body) {
        const value = JSON.parse(body)
        equal(value.query, 'second')
        equal(value.body, 'a different body')
      },
    },
    {
      path: '/empty',
      status: 200,
      check(body) {
        equal(body, '')
      },
    },
    {
      path: '/large',
      status: 200,
      check(body) {
        equal(body, 'response-'.repeat(8192))
      },
    },
    { path: '/missing', status: 404 },
    { path: '/fail', status: 500 },
    {
      path: '/echo?q=after-errors',
      body: 'last',
      status: 200,
      check(body) {
        equal(JSON.parse(body).body, 'last')
      },
    },
  ])
  await exchange(18083, [
    { path: '/health', status: 200 },
    { path: '/mcp', body: '{}', status: 401 },
    { path: '/mcp', token: 'wrong', body: '{}', status: 401 },
    {
      path: '/mcp',
      token: 'test-token',
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      status: 200,
      check(body) {
        equal(JSON.parse(body).id, 1)
      },
    },
    {
      path: '/mcp',
      token: 'test-token',
      body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      status: 200,
      check(body) {
        equal(JSON.parse(body).id, 2)
      },
    },
  ])
  for (let i = 0; i < 100; i++) {
    await exchange(18082, [
      {
        path: `/echo?q=${i}`,
        body: String(i),
        status: 200,
        check(body) {
          const value = JSON.parse(body)
          equal(value.query, String(i))
          equal(value.body, String(i))
        },
      },
    ])
  }
  await exchange(18084, [
    {
      path: '/echo',
      body: '12345678',
      status: 200,
      check(body) {
        equal(body, '12345678')
      },
    },
  ])
  await rejectOversizedBody()
  equal(routedLimitedRequests, 1, 'oversized requests never reach the handler')
  await exchange(18084, [{ path: '/echo', body: 'ok', status: 200 }])
  trace('ok\n')
} finally {
  limited.close()
  app.close()
  mcp.close()
}
