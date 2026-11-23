import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
const aliases = {
  'stackchan/voice/media': new URL('../../voice/media.ts', import.meta.url).href,
  'stackchan/voice/scope': new URL('../../voice/scope.ts', import.meta.url).href,
}
registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(aliases[specifier] ?? specifier, context) } })
const { createBorrowedChatIO } = await import('../chat-audioio/borrowed-io.js')
const { mono, createPcmSource } = await import('../../voice/media.ts')
const states = {DISCONNECTED:0, CONNECTING:1, CONNECTED:2, SPEAKING:3, LISTENING:4, WAITING:5, FAILED:6}
function setup(inputRate, maxBufferedMs, specifier) {
  const sent = [], source = createPcmSource(mono(inputRate)), io = {}
  createBorrowedChatIO(io, {
    specifier, onStateChanged() {}, media: {input:source.output, output:{
      format:mono(24000), budget:{maxBufferedBytes:128 * 1024,maxBufferedMs},
    }},
  }, states, () => 0)
  io.worker = {postMessage: message => sent.push(message),terminate(){}}
  return {io,sent,source}
}
test('capture distinguishes oversized frames from exhausted borrowed slots', async () => {
  const large = setup(24000,1000,'googleGeminiLive')
  try {
    large.io.ensureInput(); large.io.connected()
    await assert.rejects(large.source.push(new Uint8Array(2050)), /Chat input overrun: frame too large/)
    assert.equal(large.sent.length, 0)
  } finally { large.io.close() }
  const full = setup(24000,1000,'googleGeminiLive')
  try {
    full.io.ensureInput(); full.io.connected()
    for (let i=0;i<4;i++) await full.source.push(new Uint8Array(2048))
    await assert.rejects(full.source.push(new Uint8Array(2048)), /Chat input overrun: slots exhausted/)
    assert.equal(full.sent.length, 4)
  } finally { full.io.close() }
})

test('worker-consumed slots are reusable in the same capture callback before JS ACK delivery', () => {
  const f=setup(24000,1000,'googleGeminiLive'), copied=[]
  f.io.worker.postMessage=m=>{
    if(m.id!=='sendAudio')return
    copied.push([...new Uint8Array(f.io.inputBuffer,m.offset,m.size)])
    // Simulate the worker VM finishing while the main capture callback is still running.
    if(f.io.inputSlotState) Atomics.store(new Int32Array(f.io.inputSlotState),m.slot,0)
  }
  try {
    f.io.ensureInput();f.io.connected()
    for(let i=0;i<16;i++) f.source.offer(Uint8Array.of(i,0))
    assert.deepEqual(copied,Array.from({length:16},(_,i)=>[i,0]))
    assert.equal(f.io.inputBuffer.byteLength,8192)
  } finally {f.io.close()}
})
