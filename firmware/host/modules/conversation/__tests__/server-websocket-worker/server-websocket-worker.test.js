import { postedMessages } from 'ChatWorker'
import ChatAudioIO from 'stackchanChatAudioIO'
import ServerChatWebSocketWorker from 'stackchanServerChatWebSocketWorker'
import { equal } from 'testing/assert'
import Timer from 'timer'
import { workers } from 'worker'

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
    if (this.writeError) throw this.writeError
    this.writes.push({ data, options })
    return 0
  }

  notifyReadable(data, options = { more: false }) {
    this.readable = data
    this.options.onReadable(data.byteLength, options)
  }

  notifyWritable(count) {
    this.options.onWritable(count)
  }
}

class SecureWebSocket extends FakeWebSocket {
  static close = 88
}

class TestWorker extends ServerChatWebSocketWorker {
  audioPrefix = new Uint8Array(0)
  audioSuffix = new Uint8Array(0)
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

const queuedWorker = new TestWorker({ outputSampleRate: 24000, connectTimeoutMs: 1 })
equal(postedMessages.at(-1)?.id, 'audioBackpressure', 'the worker should advertise audio backpressure')
queuedWorker.connect(connection)
queuedWorker.sendJSON({ type: 'queued.before.open' })
const queuedSocket = sockets[0]
equal(queuedSocket?.writes.length, 0, 'a write should queue until the socket reports capacity')
queuedSocket?.notifyWritable(256)
equal(queuedWorker.openCount, 1, 'the first writable callback should open the worker once')
equal(queuedSocket?.writes.length, 1, 'the first writable callback should flush queued data')
queuedWorker.binaryInput = true
queuedWorker.sendAudio({ offset: 0, size: 32 })
equal(postedMessages.at(-1)?.id, 'audioSent', 'accepted audio should acknowledge the main machine')
queuedSocket?.notifyWritable(256)
equal(queuedSocket?.writes.at(-1)?.options.binary, true, 'PCMA input should use a binary WebSocket frame')

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

const binaryWorker = new ServerChatWebSocketWorker({ outputSampleRate: 24000 })
binaryWorker.connect(connection)
let binaryBytes = 0
binaryWorker.parser = { copy: (data) => (binaryBytes += data.byteLength) }
sockets[2]?.notifyReadable(new Uint8Array(32).buffer, { binary: true, more: false })
equal(binaryBytes, 32, 'binary WebSocket payloads should be copied directly to the audio ring')

earlyReadWorker.disconnect()
equal(
  earlyReadSocket?.writes[0]?.options.opcode,
  SecureWebSocket.close,
  'disconnect should use the close opcode from the selected secure socket class',
)

const failedWorker = new TestWorker({ outputSampleRate: 24000 })
failedWorker.connect(connection)
const failedSocket = sockets[3]
failedSocket?.notifyWritable(256)
failedSocket.writeError = new Error('not ready')
failedWorker.sendJSON({ type: 'write.after.transport.close' })
equal(postedMessages.at(-1)?.id, 'failed', 'write exceptions must notify the main machine')
equal(postedMessages.at(-1)?.string, 'websocket write failed: not ready', 'write exceptions must retain their cause')
equal(failedWorker.ws, null, 'a failed transport must be closed')

const directAudio = new ChatAudioIO({ specifier: 'direct' })
const directWorker = workers.at(-1)
directAudio.worker.postMessage({ id: 'sendAudio', offset: 0, size: 1024 })
directAudio.worker.postMessage({ id: 'sendAudio', offset: 1024, size: 1024 })
equal(directWorker.audioMessages.length, 2, 'workers without ACK support should remain unchanged')

const gatedAudio = new ChatAudioIO({ specifier: 'gated' })
const gatedWorker = workers.at(-1)
gatedWorker.onmessage({ id: 'audioBackpressure' })
const stateChanges = []
const stateAudioIO = new ChatAudioIO({ specifier: 'state', onStateChanged: (state) => stateChanges.push(state) })
stateAudioIO.wait()
stateAudioIO.resume()
equal(stateChanges.join(','), '6,4', 'waiting and empty response should update the public state')

gatedAudio.worker.postMessage({ id: 'sendAudio', offset: 0, size: 1024 })
gatedAudio.worker.postMessage({ id: 'sendAudio', offset: 1024, size: 1024 })
gatedAudio.worker.postMessage({ id: 'sendAudio', offset: 2048, size: 1024 })
equal(gatedWorker.audioMessages.length, 1, 'only one audio message may enter the native worker queue')
gatedWorker.onmessage({ id: 'audioSent' })
equal(gatedWorker.audioMessages.length, 2, 'an ACK should release the next audio message')
equal(gatedWorker.audioMessages.at(-1)?.size, 2048, 'contiguous queued audio should be coalesced')
for (let index = 0; index < 65; index += 1) {
  gatedAudio.worker.postMessage({ id: 'sendAudio', offset: (index + 3) * 1024, size: 1024 })
}
equal(gatedAudio.error, 'audio worker backpressure', 'a stalled worker should fail before its queue is unbounded')

const timeoutWorker = new TestWorker({ outputSampleRate: 24000, connectTimeoutMs: 1 })
timeoutWorker.connect(connection)
Timer.set(() => {
  equal(postedMessages.at(-1)?.id, 'failed', 'a stalled connection should notify the main machine')
  equal(
    postedMessages.at(-1)?.string,
    'websocket connection timed out',
    'a stalled connection should retain its timeout cause',
  )
  equal(timeoutWorker.ws, null, 'a timed out transport should be closed')
  equal(queuedWorker.ws, queuedSocket, 'an opened transport should cancel its connection timeout')
  trace('ok\n')
}, 10)
Timer.set(() => {}, 1000)
