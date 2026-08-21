import { postedMessages } from 'ChatWorker'
import ServerChatWebSocketWorker from 'stackchanServerChatWebSocketWorker'
import { equal } from 'testing/assert'
import Timer from 'timer'

trace('=== server-websocket-worker test ===\n')

const sockets = []

class FakeWebSocket {
  static close = 8
  static ping = 9
  static pong = 10

  constructor(options) {
    this.options = options
    this.writes = []
    this.readable = new ArrayBuffer(0)
    sockets.push(this)
  }

  close() {}

  read() {
    return this.readable
  }

  write(data, options) {
    this.writes.push({ data, options })
    return 0
  }

  notifyReadable(data) {
    this.readable = data
    this.options.onReadable(data.byteLength, { more: false })
  }

  notifyWritable(count) {
    this.options.onWritable(count)
  }
}

class SecureWebSocket extends FakeWebSocket {
  static close = 88
}

class TestWorker extends ServerChatWebSocketWorker {
  eventHandlers = Object.freeze({ 'session.created': true })
  openCount = 0
  readCount = 0
  sessionCreatedCount = 0

  onOpen() {
    this.openCount += 1
  }

  read() {
    this.readCount += 1
  }

  'session.created'() {
    this.sessionCreatedCount += 1
  }
}

globalThis.device = {
  network: {
    ws: { io: FakeWebSocket },
    wss: { io: SecureWebSocket },
  },
}

const connection = {
  barrier: new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)),
  inputBuffer: new SharedArrayBuffer(2048),
  outputBuffer: new SharedArrayBuffer(2048),
}

const queuedWorker = new TestWorker({ outputSampleRate: 24000 })
queuedWorker.connect(connection)
queuedWorker.sendJSON({ type: 'queued.before.open' })
const queuedSocket = sockets[0]
equal(queuedSocket?.writes.length, 0, 'a write should queue until the socket reports capacity')
queuedSocket?.notifyWritable(256)
equal(queuedWorker.openCount, 1, 'the first writable callback should open the worker once')
equal(queuedSocket?.writes.length, 1, 'the first writable callback should flush queued data')

const earlyReadWorker = new TestWorker({ outputSampleRate: 24000 })
earlyReadWorker.connect(connection)
const earlyReadSocket = sockets[1]
earlyReadSocket?.notifyReadable(ArrayBuffer.fromString('{"type":"session.created"}'))
equal(earlyReadWorker.openCount, 1, 'an early readable callback should open the worker')
equal(earlyReadWorker.readCount, 1, 'data received before the first writable callback should be processed')
earlyReadSocket?.notifyWritable(256)
equal(earlyReadWorker.openCount, 1, 'a later writable callback should not reopen the worker')

earlyReadWorker.onJSON({ type: 'disconnect' })
equal(earlyReadSocket?.writes.length, 0, 'an undeclared remote event must not invoke a transport method')
earlyReadWorker.onJSON({ type: 'session.created' })
equal(earlyReadWorker.sessionCreatedCount, 1, 'an explicitly allowed event should invoke its handler')

earlyReadWorker.disconnect()
equal(
  earlyReadSocket?.writes[0]?.options.opcode,
  SecureWebSocket.close,
  'disconnect should use the close opcode from the selected secure socket class',
)
earlyReadSocket?.options.onError(new Error('TLS failed'))
equal(postedMessages[postedMessages.length - 1]?.string, 'network error: TLS failed', 'network errors include details')

trace('ok\n')
Timer.set(() => {}, 1000)
