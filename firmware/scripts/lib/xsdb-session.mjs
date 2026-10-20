import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { delimiter, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'

// Accept a whole trace line, including the SDK's thread/prompt decoration.
// JSON diagnostics or text that merely mentions a marker are not completion.
export function moduleTestResult(log) {
  const markers = [...log.matchAll(/^(?:\(xsdb\) *)?(?:\[Thread \d+\] )?@@STACKCHAN_TEST:(PASS|FAIL)@@\r?$/gm)]
  if (markers.some((match) => match[1] === 'FAIL')) return 'fail'
  if (markers.length) return 'pass'
}

// Only use for owned children spawned with detached: true.
const stopping = new WeakMap()
export function stopProcessGroup(child) {
  if (!child.pid) return Promise.resolve()
  if (stopping.has(child)) return stopping.get(child)
  const signal = (name) => {
    try {
      process.kill(-child.pid, name)
    } catch {
      child.kill(name)
    }
  }
  const stopped = new Promise((resolve) => {
    const timeout = setTimeout(() => signal('SIGKILL'), 2000)
    child.once('close', () => {
      clearTimeout(timeout)
      // A wrapper may exit while a descendant that closed its pipes is alive.
      signal('SIGKILL')
      resolve()
    })
    signal('SIGTERM')
  })
  stopping.set(child, stopped)
  return stopped
}

export async function startXsdbSession(logPath, project, sdk) {
  project = resolve(project)
  const port = await new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, '.xsdb.json'), JSON.stringify({ outputFormat: 'text', timestamps: 'off' }))
  writeFileSync(logPath, '')
  let log = '',
    error,
    closed = false
  const child = spawn(process.execPath, [join(sdk, 'tools/xsbug-log/xsbug-log.js')], {
    cwd: project,
    env: {
      ...process.env,
      XSBUG_LOG_PORT: String(port),
      XSBUG_PROJECT: project,
      NODE_PATH: [join(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter),
    },
  })
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('xsdb startup timeout')), 10000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => appendFileSync(logPath, chunk))
    // readline retains split lines; stdout's decoder retains split UTF-8 bytes.
    createInterface({ input: child.stdout }).on('line', (line) => {
      line = stripVTControlCharacters(line)
      log += `${line}\n`
      if (line.includes(`xsdb listening on port ${port}.`)) {
        clearTimeout(timeout)
        resolve(port)
      }
    })
    child.stderr.on('data', (chunk) => {
      appendFileSync(logPath, chunk)
      error = String(chunk)
    })
    child.on('error', (failure) => {
      error = failure.message
      clearTimeout(timeout)
      reject(failure)
    })
    child.on('exit', (code, signal) => {
      closed = true
      error = `xsdb exited: code=${code} signal=${signal}`
      clearTimeout(timeout)
      reject(new Error(error))
    })
  })
  return {
    ready,
    getLog: () => log,
    getError: () => error,
    close: async () => {
      if (closed) return
      await new Promise((resolve) => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 2000)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.kill('SIGTERM')
      })
    },
  }
}
