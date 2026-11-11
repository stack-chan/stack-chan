import { createBorrowedChatIO } from 'stackchanBorrowedChatIO'
import { startWorkerSession } from 'stackchanChatWorkerSession'
import { createPcmSink, createPcmSource, mono } from 'stackchan/voice/media'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import Worker from 'worker'

export async function checkSdkBootstrap() {
  const worker = new Worker('stackchanVoiceChatWorker')
  let deadline
  try {
    const configured = new Promise((resolve, reject) => {
      deadline = Timer.set(() => reject(new Error('SDK worker startup timed out')), 2500)
      worker.onmessage = (message) => {
        if (message.id === 'failed') reject(new Error(message.string))
        if (message.id === 'configureAudio') resolve(message)
      }
    })
    worker.postMessage({ id: 'configure', workerSpecifier: 'openAIRealtime', inputRate: 8000, outputRate: 24000 })
    const format = await configured
    equal(format.inputSampleRate, 8000)
    equal(format.outputSampleRate, 24000)
  } finally {
    Timer.clear(deadline)
    worker.terminate()
  }
}

export function checkWorkerFlow() {
  let model
  const events = []
  const worker = { postMessage: (message) => events.push(message) }
  class DelayedProvider {
    constructor() {
      model = this
      worker.onmessage = (message) => this[message.id](message)
    }
    configure() {
      this.ws = { write: () => 0 }
      this.parser = { barrier: new Int32Array(new SharedArrayBuffer(8)) }
      this.unsent = []
    }
    sendAudio({ size }) {
      this.write(new Uint8Array(size))
    }
    write(bytes) {
      this.unsent.push(bytes)
    }
  }
  startWorkerSession(worker, DelayedProvider, { id: 'configure', inputRate: 8000, outputRate: 24000 })
  worker.onmessage({ id: 'sendAudio', size: 1024, slot: 3 })
  equal(events.length, 0, 'Encoding alone does not free a microphone slot')
  const packet = model.unsent.shift()
  model.ws.write(packet.subarray(0, 128))
  equal(events.length, 0, 'Partial socket write retains the slot')
  model.ws.write(packet.subarray(128))
  equal(events[0].id, 'audioConsumed')
  equal(events[0].slot, 3)
  Atomics.store(model.parser.barrier, 1, 1)
  let cancelled = false
  try {
    model.parser.wait(0, 64, 1)
  } catch {
    cancelled = true
  }
  assert(cancelled, 'Decoder wait observes the shutdown flag')
  worker.onmessage({ id: 'sendAudio', size: 65536, slot: 1 })
  worker.onmessage({ id: 'sendAudio', size: 1, slot: 2 })
  equal(model.unsent.length, 1, 'Stalled provider cannot queue bytes above the network limit')
  equal(events[1].id, 'failed')
}

export async function checkBorrowedAudio() {
  const source = createPcmSource(mono(8000))
  const states = { DISCONNECTED: 0, CONNECTED: 1, SPEAKING: 2, LISTENING: 3, WAITING: 4, FAILED: 5 }
  const sent = [],
    played = []
  const output = {
    format: mono(24000),
    budget: { maxBufferedBytes: 131072, maxBufferedMs: 2000 },
    begin() {
      return createPcmSink(this.format, (bytes) => {
        played.push(...bytes)
      })
    },
    async finish(id) {
      return { outputId: id, generation: 0, state: 'played', position: { basis: 'unknown' } }
    },
    async fence() {
      return []
    },
  }
  let receipt,
    terminated = false
  const io = {}
  createBorrowedChatIO(
    io,
    {
      media: { input: source.output, output },
      specifier: 'openAIRealtime',
      onStateChanged() {},
      onPlayback(value) {
        receipt = value
      },
    },
    states,
    () => 0,
  )
  io.worker = {
    postMessage: (m) => sent.push(m),
    terminate() {
      terminated = true
    },
  }
  io.ensureInput()
  io.connected()
  for (let i = 0; i < 4; i++) await source.push(Uint8Array.of(i, 0))
  const held = new Uint8Array(io.inputBuffer, sent[0].offset, 2)
  io.releaseInputSlot(sent[3].slot)
  await source.push(Uint8Array.of(99, 0))
  equal(held[0], 0, 'Older slot stays borrowed until its own acknowledgment')
  equal(sent[4].slot, sent[3].slot, 'Only acknowledged microphone slot is reused')
  io.listen()
  const ring = new Uint8Array(io.outputBuffer)
  ring.set([1, 2], ring.length - 2)
  ring.set([3, 4], 0)
  io.receiveAudio({ offset: ring.length - 2, size: 4 })
  io.speak()
  await io.drain()
  equal(played.join(','), '1,2,3,4', 'Wraparound produces contiguous samples on the borrowed speaker')
  equal(Atomics.load(io.barrier, 0), 2)
  equal(receipt.state, 'played')
  io.close()
  equal(Atomics.load(io.barrier, 1), 1, 'Closing wakes a blocked decoder')
  equal(terminated, true)
}
