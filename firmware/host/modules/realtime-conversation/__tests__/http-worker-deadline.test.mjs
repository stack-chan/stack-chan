import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

test('the actual HTTP Worker drops a request that expires while waiting behind another request', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-http-worker-deadline-'))
  const previous = new Map(
    ['self', 'device', '__httpWorkerDeadline'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  )
  const state = { ticks: 1000, executed: [], replies: [], pending: [] }
  function modulePackage(name, exports, sources) {
    const target = path.join(directory, 'node_modules', name)
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module', exports }))
    for (const [filename, source] of Object.entries(sources)) writeFileSync(path.join(target, filename), source)
    return target
  }
  try {
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}')
    const realtime = modulePackage(
      'realtimeConversation',
      {
        './http-core': './http-core.js',
        './http-queue': './http-queue.js',
      },
      {
        'http-core.js': `
        export const createClosingClient = (Client, options) => new Client(options)
        export const guardSocketCallbacks = (Socket) => Socket
        export function requestHttps(request) {
          const state = globalThis.__httpWorkerDeadline
          state.executed.push(request)
          if (request.path === '/first') return new Promise((resolve) => state.pending.push(resolve))
          return Promise.resolve({ status: 200, body: new ArrayBuffer(0) })
        }
      `,
      },
    )
    copyFileSync(new URL('../http-queue.js', import.meta.url), path.join(realtime, 'http-queue.js'))
    modulePackage('time', './index.js', {
      'index.js': `export default {
        get ticks() { return globalThis.__httpWorkerDeadline.ticks },
        delta(start, end) { return end - start },
      }`,
    })
    modulePackage('timer', './index.js', {
      'index.js':
        'export default { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (timer) => clearTimeout(timer) }',
    })
    modulePackage(
      'ssl',
      { './cache': './cache.js' },
      {
        'cache.js': 'export default { deleteSessionID() {} }',
      },
    )
    globalThis.__httpWorkerDeadline = state
    globalThis.self = { postMessage: (message) => state.replies.push(message) }
    globalThis.device = { network: { https: { client: { io: class {}, socket: { TCP: { io: class {} } } } } } }
    const worker = path.join(directory, 'http-worker.js')
    // Copy only to give the real modules an isolated platform-resolution root;
    // the Worker and queue execute unchanged, with no source-text assertions.
    copyFileSync(new URL('../http-worker.js', import.meta.url), worker)
    await import(pathToFileURL(worker).href)
    const first = self.onmessage({ id: 1, started: state.ticks, request: { path: '/first', timeoutMs: 1000 } })
    await new Promise(setImmediate)
    assert.equal(state.pending.length, 1, 'the first HTTPS request has started')
    const second = self.onmessage({ id: 2, started: state.ticks, request: { path: '/expired', timeoutMs: 5 } })
    state.ticks += 10
    state.pending.shift()({ status: 200, body: new ArrayBuffer(0) })
    await Promise.all([first, second])
    assert.deepEqual(
      state.executed.map((request) => request.path),
      ['/first'],
      'expired HTTPS work never starts',
    )
    assert.deepEqual(
      state.replies.map((reply) => reply.id),
      [1],
    )
    assert.equal(state.executed[0].timeoutMs, 1000, 'the first request retains its available deadline')
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
