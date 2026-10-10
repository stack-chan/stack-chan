import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { delimiter, join } from 'node:path'

// xsdb emits pretty-printed JSON mixed with prompts. Frame JSON objects across
// arbitrary pipe chunks; braces inside escaped trace strings are not framing.
export function jsonEvents(onEvent) {
  let frame = '',
    depth = 0,
    quoted = false,
    escaped = false
  return (chunk) => {
    for (const character of chunk) {
      if (!depth && character !== '{') continue
      frame += character
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
      } else if (character === '"') quoted = true
      else if (character === '{') depth++
      else if (character === '}' && --depth === 0) {
        let event
        try {
          event = JSON.parse(frame)
        } catch {
          /* non-JSON debugger text */
        }
        if (event) onEvent(event)
        frame = ''
      }
    }
  }
}

export function successfulTestSummary(data) {
  return data?.passed > 0 && data.failed === 0 && !data.reason && data.total === data.passed + data.skipped
}

export async function startXsdbSession(logPath, project, sdk, onEvent = () => {}) {
  // Reserve an ephemeral port first. A collision is an error, never consent to
  // xsdb's prompt to kill an unrelated debugger using the port.
  const port = await new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
  mkdirSync(project, { recursive: true })
  writeFileSync(
    join(project, '.xsdb.json'),
    JSON.stringify({ outputFormat: 'json', testTimeout: 30, testLog: project }),
  )
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
    const parse = jsonEvents((event) => {
      if (event.error) error = JSON.stringify(event.error)
      if (event.event === 'log') log += `${event.data.text}\n`
      onEvent(event)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      appendFileSync(logPath, chunk)
      if (chunk.includes('xsdb listening on port')) {
        clearTimeout(timeout)
        resolve(port)
      }
      parse(chunk)
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
    command: (command) => child.stdin.write(`${command}\n`),
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
