import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export function invalidateMuseCascadedBindings({ directory, selector }) {
  if (selector !== '--setup' && selector !== '--cascaded-offline')
    throw new Error('Unsupported Muse cascaded binding target')
  const files = ['main.xsb', 'audio-in.xsb', 'stackchan/voice/cores3-pcm-output.xsb'].map((file) =>
    path.join(directory, 'modules', file),
  )
  for (const file of files) rmSync(file, { force: true })
  return files
}

export function validateMuseCascadedBindings({ directory, firmwareDirectory, selector }) {
  const target = {
    '--setup': { main: 'setup-device/main.js', 'audio-in': 'stopwatch-audio/input.js' },
    '--cascaded-offline': {
      main: '__tests__/cascaded-device/main.js',
      'audio-in': '__tests__/cascaded-device/silent-input.js',
    },
  }[selector]
  if (!target) throw new Error('Unsupported Muse cascaded binding target')
  const expected = Object.fromEntries(
    Object.entries({ ...target, 'stackchan/voice/cores3-pcm-output': 'setup-device/cascaded-output.js' }).map(
      ([name, source]) => [
        name,
        path.join(firmwareDirectory, 'host/modules/muse-gadget', source).replaceAll('\\', '/'),
      ],
    ),
  )
  const lines = readFileSync(path.join(directory, 'makefile'), 'utf8').replaceAll('\\', '/').split(/\r?\n/)
  for (const [name, source] of Object.entries(expected)) {
    const prefix = `$(MODULES_DIR)/${name}.xsb:`
    const rules = lines.filter((line) => line.startsWith(prefix))
    if (rules.length !== 1 || rules[0].slice(prefix.length).trim() !== source)
      throw new Error(`Muse cascaded binding ${name} must select ${source} exactly once`)
  }
  return expected
}
