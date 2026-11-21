import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('rate fixture waits, skips if no longer quiet, and cannot be rearmed', async () => {
  const output = []
  const timers = []
  const context = vm.createContext({ trace: (line) => output.push(line.trim()) })
  const module = new vm.SourceTextModule(await readFile(new URL('./rate-replay.js', import.meta.url), 'utf8'), { context })
  const imports = {
    'stackchan/voice/cores3-pcm-output': { openStreamingOutput: () => assert.fail('must not open audio') },
    'gemini-worker-events': { createSpeechEvents: () => assert.fail('must not parse audio') },
    time: { default: {} },
    timer: { default: { set: (callback, delay) => timers.push({ callback, delay }) } },
  }
  await module.link((name) => {
    const values = imports[name]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  let active = true
  const opts = { active: () => active, onDone: () => assert.fail('must not complete skipped replay') }
  assert.equal(module.namespace.arm(opts), true)
  assert.equal(module.namespace.arm(opts), false)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 1500)
  active = false
  timers[0].callback()
  assert.deepEqual(output, ['MUSE_RATE_ARMED', 'MUSE_RATE_SKIPPED'])
  assert.equal(module.namespace.arm(opts), false)
})
