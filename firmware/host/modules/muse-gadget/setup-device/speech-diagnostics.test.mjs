import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpeechDiagnostics } from './speech-diagnostics.js'

function fixture() {
  let now = 0,
    tick,
    clears = 0,
    reads = 0
  const output = []
  const diagnostics = createSpeechDiagnostics({
    timer: {
      repeat(callback, ms) {
        assert.equal(ms, 100)
        tick = callback
        return 7
      },
      clear(handle) {
        assert.equal(handle, 7)
        clears++
      },
    },
    heap: {
      now: () => now,
      internalFree: () => {
        reads++
        return 42000
      },
      internalMinimum: () => 31000,
      internalLargest: () => 16000,
      psramFree: () => 3000000,
    },
    emit: (value) => output.push(value),
  })
  return {
    diagnostics,
    output,
    advance(ms, fire = true) {
      now += ms
      if (fire) tick()
    },
    get reads() {
      return reads
    },
    get clears() {
      return clears
    },
  }
}

test('timer only tracks monotonic lateness; heap is read at fixed event boundaries', () => {
  const f = fixture()
  f.advance(100)
  f.advance(137)
  assert.equal(f.reads, 0)
  f.diagnostics.event({ type: 'turn.started' })
  assert.equal(f.output[0], 'MUSE_DIAG 1 42000 31000 16000 3000000 37\n')
  f.advance(180, false)
  f.diagnostics.event({ type: 'output.text', delta: 'PRIVATE response' })
  assert.equal(f.output[1], 'MUSE_DIAG 2 42000 31000 16000 3000000 80\n')
})

test('streamed text is summarized once per turn and payloads never reach logs', () => {
  const f = fixture()
  for (const type of ['input.level', 'input.transcript', 'toString', '__proto__', 'secret'])
    f.diagnostics.event({ type, value: 'PRIVATE' })
  for (let i = 0; i < 100; i++) f.diagnostics.event({ type: 'output.text', delta: 'PRIVATE' })
  f.diagnostics.event({ type: 'error', code: 'PRIVATE', message: 'PRIVATE' })
  f.diagnostics.event({ type: 'turn.ended', result: 'PRIVATE' })
  f.diagnostics.event({ type: 'turn.started' })
  f.diagnostics.event({ type: 'output.text', delta: 'PRIVATE' })
  assert.equal(f.reads, 5)
  for (const line of f.output) assert.match(line, /^MUSE_DIAG [1-4]( \d+){5}\n$/)
})

test('closing clears the timer once and fences stale callbacks and events', () => {
  const f = fixture()
  f.diagnostics.close()
  f.diagnostics.close()
  f.advance(1000)
  f.diagnostics.event({ type: 'error' })
  assert.equal(f.clears, 1)
  assert.equal(f.reads, 0)
  assert.deepEqual(f.output, [])
})
