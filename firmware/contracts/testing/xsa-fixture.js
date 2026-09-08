// Structural fixtures for archive readers; CODE deliberately does not contain executable bytecode.
export const modDefinition = Object.freeze({
  format: 'tech.stackchan.mod',
  schemaVersion: 2,
  id: 'tech.stackchan.test',
  version: '1.0.0',
  type: 'text',
  name: 'Test MOD',
  description: 'Archive compatibility test',
  source: { path: 'manifest.json', entrypoint: 'mod.js' },
  appApiVersion: 2,
  hostApiVersion: 2,
  targets: ['portable'],
  capabilities: ['face'],
  entrypoints: ['mod'],
})

// Exercise the same malformed metadata at every archive entry point.
export const invalidModSettings = [
  { 'wifi.ssid': 'app-network' },
  { 'renderer.type': 'dog' },
  { 'tts.unknown': 1 },
  { 'tts.volume': 1.2 },
  { 'tts.port': 80.5 },
  { 'driver.baudrate': 9_599 },
  { 'ui.type': 'missing' },
  { 'tts.token': '\ud800' },
  { 'ai.context': '🤖'.repeat(513) },
  { 'tts.voice': 'name\0tail' },
  { 'ai.context': null },
  { 'tts.type': 'obsolete' },
]

export function xsAtom(tag, ...payloads) {
  const bytes = new Uint8Array(8 + payloads.reduce((sum, payload) => sum + payload.length, 0))
  new DataView(bytes.buffer).setUint32(0, bytes.length, false)
  bytes.set(new TextEncoder().encode(tag), 4)
  let offset = 8
  for (const payload of payloads) {
    bytes.set(payload, offset)
    offset += payload.length
  }
  return bytes
}

export function xsPath(name) {
  return xsAtom('PATH', new TextEncoder().encode(`${name}\0`))
}

/** @param {{metadata?: unknown, version?: number[], entrypoints?: string[], padding?: number}} [options] */
export function makeXsArchive({
  metadata = modDefinition,
  version = [17, 8, 0],
  entrypoints = ['mod'],
  padding = 0,
} = {}) {
  return xsAtom(
    'XS_A',
    xsAtom('VERS', new Uint8Array([...version, 0])),
    xsAtom('SIGN', new Uint8Array(16)),
    xsAtom('NAME', new TextEncoder().encode('fixture\0')),
    xsAtom('SYMB', new Uint8Array(2)),
    xsAtom('IDEN'),
    xsAtom('MAPS'),
    xsAtom('MODS', ...entrypoints.flatMap((name) => [xsPath(name), xsAtom('CODE', new Uint8Array(padding))])),
    xsAtom(
      'RSRC',
      ...(metadata === null
        ? []
        : [xsPath('stackchan-mod.json'), xsAtom('DATA', new TextEncoder().encode(JSON.stringify(metadata)))]),
    ),
  )
}
