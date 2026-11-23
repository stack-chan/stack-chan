import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { invalidateMuseCascadedBindings, validateMuseCascadedBindings } from './muse-cascaded-bindings.mjs'

const firmwareDirectory = fileURLToPath(new URL('../../', import.meta.url))
const base = path.join(firmwareDirectory, 'host/modules/muse-gadget').replaceAll('\\', '/')
const rule = (name, source) => `$(MODULES_DIR)/${name}.xsb: ${base}/${source}`
const sources = {
  '--setup': { main: 'setup-device/main.js', 'audio-in': 'stopwatch-audio/input.js' },
  '--cascaded-offline': {
    main: '__tests__/cascaded-device/main.js',
    'audio-in': '__tests__/cascaded-device/silent-input.js',
  },
}
function fixture(selector, run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'muse-cascaded-binding-'))
  const expected = { ...sources[selector], 'stackchan/voice/cores3-pcm-output': 'setup-device/cascaded-output.js' }
  const lines = Object.entries(expected).map(([name, source]) => rule(name, source))
  const validate = () => validateMuseCascadedBindings({ directory, firmwareDirectory, selector })
  const write = (rules = lines) => writeFileSync(path.join(directory, 'makefile'), `${rules.join('\n')}\n`)
  try {
    write()
    run({ directory, lines, write, validate })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const selector of Object.keys(sources)) {
  test(`${selector}: invalidation removes only the three alias bytecode files`, () => {
    fixture(selector, ({ directory }) => {
      const modules = path.join(directory, 'modules')
      const changed = ['main.xsb', 'audio-in.xsb', 'stackchan/voice/cores3-pcm-output.xsb']
      const untouched = ['other.xsb', 'stackchan/voice/media.xsb', 'stackchan/voice/cores3-pcm-output.js']
      mkdirSync(path.join(modules, 'stackchan/voice'), { recursive: true })
      for (const file of [...changed, ...untouched]) writeFileSync(path.join(modules, file), 'bytecode fixture')
      invalidateMuseCascadedBindings({ directory, selector })
      for (const file of changed) assert.equal(existsSync(path.join(modules, file)), false)
      for (const file of untouched) assert.equal(readFileSync(path.join(modules, file), 'utf8'), 'bytecode fixture')
      assert.ok(existsSync(path.join(directory, 'makefile')))
      assert.doesNotThrow(() => invalidateMuseCascadedBindings({ directory, selector }))
    })
  })
  test(`${selector}: invalidation refuses to recursively remove a directory`, () => {
    fixture(selector, ({ directory }) => {
      const unexpected = path.join(directory, 'modules/main.xsb')
      mkdirSync(unexpected, { recursive: true })
      writeFileSync(path.join(unexpected, 'keep'), 'preserved')
      assert.throws(() => invalidateMuseCascadedBindings({ directory, selector }))
      assert.equal(readFileSync(path.join(unexpected, 'keep'), 'utf8'), 'preserved')
    })
  })
  test(`${selector}: accepts all three exact generated source bindings`, () => {
    fixture(selector, ({ validate }) => assert.equal(Object.keys(validate()).length, 3))
  })
  test(`${selector}: rejects included 16 kHz output winning the cascaded alias`, () => {
    fixture(selector, ({ lines, write, validate }) => {
      write([...lines.slice(0, 2), rule('stackchan/voice/cores3-pcm-output', 'stopwatch-audio/output.js')])
      assert.throws(validate, /cores3-pcm-output must select/)
    })
  })
  test(`${selector}: rejects wrong main and microphone bindings`, () => {
    fixture(selector, ({ lines, write, validate }) => {
      for (const index of [0, 1]) {
        const changed = [...lines]
        changed[index] = rule(index === 0 ? 'main' : 'audio-in', 'wrong-source.js')
        write(changed)
        assert.throws(validate, /must select/)
      }
    })
  })
  test(`${selector}: rejects duplicate or missing alias rules`, () => {
    fixture(selector, ({ lines, write, validate }) => {
      for (let index = 0; index < lines.length; index++) {
        write([...lines, lines[index]])
        assert.throws(validate, /exactly once/)
        write(lines.filter((_, i) => i !== index))
        assert.throws(validate, /exactly once/)
      }
    })
  })
}

test('invalidation rejects unrelated targets without touching their bytecode', () => {
  fixture('--setup', ({ directory }) => {
    mkdirSync(path.join(directory, 'modules'))
    const main = path.join(directory, 'modules/main.xsb')
    writeFileSync(main, 'unrelated target')
    assert.throws(() => invalidateMuseCascadedBindings({ directory, selector: '--connection-probe' }), /Unsupported/)
    assert.equal(readFileSync(main, 'utf8'), 'unrelated target')
  })
})

test('offline manifest differs from setup only in name, main, microphone source and heap diagnostics', () => {
  const directory = path.join(firmwareDirectory, 'host/modules/muse-gadget/setup-device')
  const setup = JSON.parse(readFileSync(path.join(directory, 'manifest.json')))
  const offline = JSON.parse(readFileSync(path.join(directory, 'manifest.offline-test.json')))
  setup.build.NAME = 'muse-cascaded-offline-test'
  setup.modules.main = '../__tests__/cascaded-device/main'
  setup.modules['audio-in'] = '../__tests__/cascaded-device/silent-input'
  setup.modules['offline-heap'] = '../__tests__/cascaded-device/heap'
  assert.deepEqual(offline, setup)
})
