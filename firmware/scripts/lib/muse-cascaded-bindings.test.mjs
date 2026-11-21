import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { invalidateMuseCascadedBindings, validateMuseCascadedBindings, validateRateReplayLinkedModules } from './muse-cascaded-bindings.mjs'

const firmwareDirectory = fileURLToPath(new URL('../../', import.meta.url))
const base = path.join(firmwareDirectory, 'host/modules/muse-gadget').replaceAll('\\', '/')
const rule = (name, source) => `$(MODULES_DIR)/${name}.xsb: ${path.join(base, source).replaceAll('\\', '/')}`
const sources = {
  '--setup-native-speech': {
    main: 'setup-device/main.js',
    'audio-in': 'stopwatch-audio/input.js',
    'muse-native-speech-enabled': 'setup-device/native-speech-enabled.js',
    'gemini-native-reader': '../voice/gemini-native-reader.js',
  },
  '--setup': {
    main: 'setup-device/main.js',
    'audio-in': 'stopwatch-audio/input.js',
    'muse-native-speech-enabled': 'setup-device/native-speech-disabled.js',
    'gemini-native-reader': '../voice/gemini-native-reader-disabled.js',
  },
  '--cascaded-offline': {
    main: '__tests__/cascaded-device/main.js',
    'audio-in': '__tests__/cascaded-device/silent-input.js',
    'muse-native-speech-enabled': 'setup-device/native-speech-disabled.js',
    'gemini-native-reader': '../voice/gemini-native-reader-disabled.js',
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
  test(`${selector}: invalidation removes only the target alias bytecode files`, () => {
    fixture(selector, ({ directory }) => {
      const modules = path.join(directory, 'modules')
      const changed = ['main.xsb', 'audio-in.xsb', 'stackchan/voice/cores3-pcm-output.xsb']
      changed.push('muse-native-speech-enabled.xsb', 'gemini-native-reader.xsb')
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
  test(`${selector}: accepts all exact generated source bindings`, () => {
    fixture(selector, ({ validate }) =>
      assert.equal(Object.keys(validate()).length, Object.keys(sources[selector]).length + 1),
    )
  })
  test(`${selector}: rejects included 16 kHz output winning the cascaded alias`, () => {
    fixture(selector, ({ lines, write, validate }) => {
      write([...lines.slice(0, -1), rule('stackchan/voice/cores3-pcm-output', 'stopwatch-audio/output.js')])
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

test('offline replay checks actual linked IDs, not alias names in flattened manifest', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'muse-rate-linked-'))
  const ids = [
    'main', 'muse-stopwatch-rate-fixture', 'gemini-worker-events',
    'stackchan/voice/cores3-pcm-output', 'time', 'timer',
    'muse-resampled-output', 'muse-stopwatch-output', 'pcm-resampler', 'muse-stopwatch-levels',
    'muse-buffered-playback', 'muse-buffered-pcm-page', 'muse-native-speech-enabled',
  ]
  const write = (names) => writeFileSync(path.join(directory, 'mc.xs.c'),
    names.map((id) => '{ NULL, NULL, 0, (txS1*)gxCode, 1, NULL, 0, "' + id + '", { XS_MAJOR_VERSION, XS_MINOR_VERSION, XS_PATCH_VERSION, 0 } },').join('\n'))
  try {
    write(ids.map((id) => id === 'gemini-worker-events' ? 'stopwatch-rate-events' : id))
    assert.throws(() => validateRateReplayLinkedModules({ directory, firmwareDirectory }), /missing linked module: gemini-worker-events/)
    write(ids)
    assert.equal(validateRateReplayLinkedModules({ directory, firmwareDirectory }).length, ids.length)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
