import assert from 'node:assert/strict'
import test from 'node:test'
import { startWorkerSession } from '../chat-audioio/worker-session.js'

function fixture(specifier, inputSlotState) {
  const events = []
  const self = { postMessage: message => events.push(message) }
  let model
  class Provider {
    constructor() { model = this; self.onmessage = message => this[message.id](message) }
    configure() { this.ws = { write: () => 0 }; this.unsent = [] }
    sendAudio({ bytes }) { this.write(specifier === 'googleGeminiLive' ? bytes.slice() : bytes) }
    write(bytes) { this.unsent.push(bytes) }
  }
  startWorkerSession(self, Provider, { id: 'configure', workerSpecifier: specifier, inputSlotState })
  return { self, events, get model() { return model } }
}

test('Gemini copied PCM releases its slot before a delayed network write', () => {
  const f = fixture('googleGeminiLive')
  const bytes = new Uint8Array([1, 2, 3, 4])
  f.self.onmessage({ id: 'sendAudio', bytes, slot: 0 })
  assert.deepEqual(f.events, [{ id: 'audioConsumed', slot: 0 }])
  bytes.fill(9)
  assert.deepEqual([...f.model.unsent[0]], [1, 2, 3, 4])
  f.model.ws.write(f.model.unsent[0])
  assert.equal(f.events.length, 1, 'network completion must not acknowledge twice')
})

test('a borrowed provider retains PCM until every socket byte is accepted', () => {
  const f = fixture('deepgramAgent')
  const bytes = new Uint8Array(8)
  f.self.onmessage({ id: 'sendAudio', bytes, slot: 2 })
  assert.deepEqual(f.events, [])
  f.model.ws.write(bytes.subarray(0, 4)); assert.deepEqual(f.events, [])
  f.model.ws.write(bytes.subarray(4))
  assert.deepEqual(f.events, [{ id: 'audioConsumed', slot: 2 }])
})

test('Gemini copied network backlog remains bounded', () => {
  const f = fixture('googleGeminiLive')
  for (let i = 0; i < 32; i++) f.self.onmessage({ id: 'sendAudio', bytes: new Uint8Array(2048), slot: i % 4 })
  assert.equal(f.events.filter(e => e.id === 'audioConsumed').length, 32)
  f.self.onmessage({ id: 'sendAudio', bytes: new Uint8Array(2), slot: 0 })
  assert.equal(f.model.unsent.length, 32)
  assert.equal(f.events.filter(e => e.id === 'failed').length, 1)
  assert.equal(f.events.at(-1).string, 'Chat network queue exceeded 64 KiB')
})


test('shared slot credit is returned without a late JS acknowledgement', () => {
  const state = new Int32Array(new SharedArrayBuffer(16))
  const f = fixture('googleGeminiLive', state.buffer)
  Atomics.store(state,0,1)
  f.self.onmessage({id:'sendAudio',bytes:new Uint8Array(8),slot:0})
  assert.equal(Atomics.load(state,0),0)
  assert.deepEqual(f.events,[])
  Atomics.store(state,0,1)
  f.model.ws.write(f.model.unsent[0])
  assert.equal(Atomics.load(state,0),1,'late socket progress cannot release a reused slot')
  assert.deepEqual(f.events,[])
})

test('borrowed shared slot is released exactly once, after socket acceptance', () => {
  const state = new Int32Array(new SharedArrayBuffer(16))
  const f=fixture('deepgramAgent',state.buffer)
  Atomics.store(state,2,1)
  f.self.onmessage({id:'sendAudio',bytes:new Uint8Array(8),slot:2})
  assert.equal(Atomics.load(state,2),1)
  f.model.ws.write(new Uint8Array(4));assert.equal(Atomics.load(state,2),1)
  f.model.ws.write(new Uint8Array(4));assert.equal(Atomics.load(state,2),0)
  Atomics.store(state,2,1)
  f.model.ws.write(new Uint8Array(4));assert.equal(Atomics.load(state,2),1)
  assert.deepEqual(f.events,[])
})

test('late completion from an older worker cannot release a newer session slot', () => {
  const oldState=new Int32Array(new SharedArrayBuffer(16)),newState=new Int32Array(new SharedArrayBuffer(16))
  const old=fixture('deepgramAgent',oldState.buffer)
  Atomics.store(oldState,0,1);Atomics.store(newState,0,1)
  old.self.onmessage({id:'sendAudio',bytes:new Uint8Array(8),slot:0})
  old.model.ws.write(new Uint8Array(8))
  assert.equal(Atomics.load(oldState,0),0)
  assert.equal(Atomics.load(newState,0),1)
})
