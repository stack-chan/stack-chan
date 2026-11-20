import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateCoreS3AudioBindings } from './core-s3-audio-bindings.mjs'

const firmwareDirectory = fileURLToPath(new URL('../../', import.meta.url))

function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-audio-binding-'))
  const moddableDirectory = path.join(directory, 'sdk')
  const sources = {
    'pins/audioout': path.join(firmwareDirectory, 'host/platforms/core_s3_audioout.js'),
    'pins/audioout-original': path.join(moddableDirectory, 'modules/pins/i2s/audioout.js'),
  }
  const rule = (name, source) => `$(MODULES_DIR)/${name}.xsb: ${source.replaceAll('\\', '/')}`
  const entry = (name, code = 'NULL') =>
    `{ NULL, NULL, 0, ${code}, 0, NULL, 0, "${name}", { XS_MAJOR_VERSION, XS_MINOR_VERSION, XS_PATCH_VERSION, 0 } }`
  function write({ rules = Object.entries(sources).map(([name, source]) => rule(name, source)), modules } = {}) {
    writeFileSync(path.join(directory, 'makefile'), `${rules.join('\n')}\n`)
    writeFileSync(
      path.join(directory, 'mc.xs.c'),
      modules ??
        `static const txScript gxScripts[] = {\n${Object.keys(sources)
          .map((name) => entry(name))
          .join(',\n')}\n};`,
    )
  }
  mkdirSync(moddableDirectory)
  write()
  try {
    run({ directory, moddableDirectory, sources, rule, entry, write })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the wrapper and SDK base as distinct importable native-build modules, including preloads', () => {
  fixture((f) => assert.deepEqual(validateCoreS3AudioBindings(f), f.sources))
  fixture((f) => {
    f.write({
      modules: Object.keys(f.sources)
        .map((name) => f.entry(name, '(txS1*)code'))
        .join(',\n'),
    })
    assert.deepEqual(validateCoreS3AudioBindings(f), f.sources)
  })
})

test('rejects the SDK base winning the public AudioOut name even if both module names are linked', () => {
  fixture((f) => {
    f.write({ rules: Object.keys(f.sources).map((name) => f.rule(name, f.sources['pins/audioout-original'])) })
    assert.throws(() => validateCoreS3AudioBindings(f), /pins\/audioout must select/)
  })
})

test('rejects duplicate build rules instead of relying on make recipe order', () => {
  fixture((f) => {
    f.write({
      rules: [...Object.entries(f.sources), ['pins/audioout', f.sources['pins/audioout']]].map(([name, source]) =>
        f.rule(name, source),
      ),
    })
    assert.throws(() => validateCoreS3AudioBindings(f), /exactly once/)
  })
})

test('requires actual linked module entries rather than unrelated heap strings', () => {
  fixture((f) => {
    f.write({ modules: `${f.entry('pins/audioout')}\n{ .key = { "pins/audioout-original", 123 } }` })
    assert.throws(() => validateCoreS3AudioBindings(f), /pins\/audioout-original.*linked module inventory/)
  })
})
