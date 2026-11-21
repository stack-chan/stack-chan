import assert from 'node:assert/strict'
import test from 'node:test'
import { checkVoiceHotPaths } from './voice-hot-paths.mjs'

test('new TTS providers cannot implement sample loops, including inside callbacks', () => {
  for (const body of [
    'for(let i=0;i<bytes.length;i++) sum+=bytes[i]',
    'while (ready) read()',
    'for (const byte of bytes) read(byte)',
    'bytes.forEach(read)',
    'Uint8Array.fromBase64(text)',
    'new DataView(bytes).getInt16(0)',
  ]) {
    assert.ok(checkVoiceHotPaths(`export function createAnotherTTS() { return () => { ${body} } }`).length, body)
  }
})
test('provider delegates to the codec and reads protocol metadata without forbidden bulk work', () => {
  assert.deepEqual(
    checkVoiceHotPaths(
      `export function createAnotherTTS() { return async event => { if(event.type==='audio') await pcm.write(event.data); } }`,
    ),
    [],
  )
})
test('comments and STT or bounded codec internals are not mistaken for a TTS callback', () => {
  assert.deepEqual(
    checkVoiceHotPaths(
      `// for (;;) {}\nfunction createSTT(){ for(const frame of frames) send(frame) }\nfunction codec(){ while(left) flush() }`,
    ),
    [],
  )
})
test('SSE framing rejects materializing payload arrays but permits bounded native scans', () => {
  assert.ok(checkVoiceHotPaths(`function consumeSSE(){return text.split('\\n').map(parse)}`).length)
  assert.deepEqual(
    checkVoiceHotPaths(`function consumeSSE(){ while(start < text.length){ start=text.indexOf('\\n', start)+1; } }`),
    [],
  )
})
test('reports useful source locations', () => {
  const errors = checkVoiceHotPaths('function createTTS(){\nfor (;;) {}\n}', 'voice/new.ts')
  assert.equal(errors[0].file, 'voice/new.ts')
  assert.equal(errors[0].line, 2)
})

test('TypeScript annotations are stripped without changing diagnostic locations', () => {
  const errors = checkVoiceHotPaths(
    'export function createTypedTTS(input: string): void {\n  for (;;) {}\n}',
    'voice/typed.ts',
  )
  assert.equal(errors[0].line, 2)
  assert.equal(errors[0].column, 3)
})

test('invalid or unsupported syntax fails closed instead of passing the boundary check', () => {
  assert.throws(() => checkVoiceHotPaths('export function createBadTTS( {'))
})
