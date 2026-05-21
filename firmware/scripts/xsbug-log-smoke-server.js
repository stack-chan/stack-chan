#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

const port = Number.parseInt(process.env.XSBUG_PORT ?? '5002', 10)
const host = process.env.XSBUG_HOST ?? '127.0.0.1'
const logPath = process.env.XSBUG_LOG_PATH

if (!logPath) {
  console.error('XSBUG_LOG_PATH is required')
  process.exit(1)
}

writeFileSync(logPath, '')

const append = (message) => {
  appendFileSync(logPath, message)
}

const server = createServer((socket) => {
  socket.setEncoding('utf8')
  let promptBuffer = ''
  socket.on('data', (chunk) => {
    append(chunk)
    promptBuffer += chunk

    // The debug Linux simulator pauses at startup and on breakpoints until the
    // debugger sends <go/>. Keep the smoke non-interactive so CI can inspect
    // the runtime log and continue through startup milestones.
    if (/<(login|break|bubble)\b/.test(promptBuffer)) {
      socket.write('\r\n<go/>\r\n')
      promptBuffer = ''
    } else {
      promptBuffer = promptBuffer.slice(-128)
    }
  })
  socket.on('error', (error) => {
    append(`\n[xsbug-smoke-server socket error] ${error.stack ?? error.message}\n`)
  })
})

server.on('error', (error) => {
  console.error(error.stack ?? error.message)
  process.exit(1)
})

server.listen(port, host, () => {
  console.log(`xsbug smoke log server listening on ${host}:${port}`)
})
