import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

// Minimal xsbug-protocol endpoint: collects <log> frames from a debug build
// (simulator or serial2xsbug-bridged device) and auto-answers every stop
// prompt with <go/> so execution never blocks on a debugger.
export function startXsbugServer(logPath, host = '127.0.0.1') {
  let log = ''
  let promptBuffer = ''
  let resolveReady
  const sockets = new Set()
  writeFileSync(logPath, '')
  const ready = new Promise((resolveReadyPromise) => {
    resolveReady = resolveReadyPromise
  })

  const append = (chunk) => {
    log += chunk
    writeFileSync(logPath, log)
  }

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      append(chunk)
      promptBuffer += chunk
      if (/<(login|break|bubble)\b/.test(promptBuffer)) {
        socket.write('\r\n<go/>\r\n')
        promptBuffer = ''
      } else {
        promptBuffer = promptBuffer.slice(-128)
      }
    })
    socket.on('error', (error) => {
      append(`\n[xsbug socket error] ${error.stack ?? error.message}\n`)
    })
  })

  server.listen(0, host, () => {
    resolveReady(server.address().port)
  })

  return {
    ready,
    close: () =>
      new Promise((resolveClose) => {
        // server.close() waits for open connections; a lingering simulator or
        // serial2xsbug socket would hang the runner, so drop them first.
        for (const socket of sockets) socket.destroy()
        server.close(() => resolveClose())
      }),
    getLog: () => log,
  }
}
