import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const firmwareDirectory = fileURLToPath(new URL('../../', import.meta.url))

/** Validate the native build's actual bindings, since SDK source deduplication can discard aliases. */
export function validateCoreS3AudioBindings({ directory, moddableDirectory }) {
  const makefile = readFileSync(path.join(directory, 'makefile'), 'utf8').replaceAll('\\', '/')
  const linked = readFileSync(path.join(directory, 'mc.xs.c'), 'utf8')
  const modules = [
    ...linked.matchAll(/,\s*"([^"\r\n]+)"\s*,\s*\{\s*XS_MAJOR_VERSION\s*,\s*XS_MINOR_VERSION\s*,\s*XS_PATCH_VERSION/g),
  ].map((match) => match[1])
  const expected = {
    'pins/audioout': path.join(firmwareDirectory, 'host/platforms/core_s3_audioout.js'),
    'pins/audioout-original': path.join(moddableDirectory, 'modules/pins/i2s/audioout.js'),
  }
  for (const [name, source] of Object.entries(expected)) {
    const prefix = `$(MODULES_DIR)/${name}.xsb:`
    const rules = makefile.split(/\r?\n/).filter((line) => line.startsWith(prefix))
    if (rules.length !== 1 || rules[0].slice(prefix.length).trim() !== source.replaceAll('\\', '/'))
      throw new Error(`CoreS3 audio binding ${name} must select ${source} exactly once`)
    // Preloaded modules still retain a gxScripts entry with a null code pointer.
    // Merely finding a heap string/key would not establish an importable module.
    if (modules.filter((module) => module === name).length !== 1)
      throw new Error(`CoreS3 audio binding ${name} is missing or duplicated in the linked module inventory`)
  }
  return expected
}
