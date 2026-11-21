import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export function invalidateMuseCascadedBindings({ directory, selector }) {
  if (!['--setup', '--setup-native-speech', '--cascaded-offline', '--setup-rate-replay'].includes(selector))
    throw new Error('Unsupported Muse cascaded binding target')
  const names = ['main.xsb', 'audio-in.xsb', 'stackchan/voice/cores3-pcm-output.xsb']
  names.push('muse-native-speech-enabled.xsb', 'gemini-native-reader.xsb')
  const files = names.map((file) => path.join(directory, 'modules', file))
  for (const file of files) rmSync(file, { force: true })
  return files
}

export function validateMuseCascadedBindings({ directory, firmwareDirectory, selector }) {
  const target = {
    '--setup-rate-replay': {
      main: 'setup-device/main.js',
      'muse-stopwatch-rate-fixture': 'setup-device/rate-replay.js',
      'audio-in': 'stopwatch-audio/input.js',
      'muse-native-speech-enabled': 'setup-device/native-speech-enabled.js',
      'gemini-native-reader': '../voice/gemini-native-reader.js',
    },
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

// The flattened manifest may contain two aliases for one file while xsl links
// only the first. Check the generated script table, not the manifest claims.
export function validateRateReplayLinkedModules({ directory, firmwareDirectory }) {
  const linked = readFileSync(path.join(directory, 'mc.xs.c'), 'utf8')
  const ids = new Set(Array.from(linked.matchAll(/"([^"]+)",\s*\{\s*XS_MAJOR_VERSION,\s*XS_MINOR_VERSION,\s*XS_PATCH_VERSION,\s*0\s*\}/g), (m) => m[1]))
  const fixture = path.join(firmwareDirectory, 'host/modules/muse-gadget/setup-device')
  const required = new Set(['main', 'muse-stopwatch-rate-fixture'])
  for (const file of ['rate-replay.js', 'cascaded-output.js', '../stopwatch-audio/output.js']) {
    const source = readFileSync(path.join(fixture, file), 'utf8')
    for (const [, id] of source.matchAll(/^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/gm)) required.add(id)
  }
  for (const id of required) {
    if (!ids.has(id)) throw new Error('Offline rate replay missing linked module: ' + id)
  }
  return [...required]
}
