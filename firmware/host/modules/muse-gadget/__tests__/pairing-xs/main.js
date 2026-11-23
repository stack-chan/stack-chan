import receive from 'boundary'

try {
  for (let i = 0; i < 100; i++) {
    const r = receive('{}')
    if (r.kind !== 'finished' || r.generation !== 7 || r.confirmationRequired !== true)
      throw Error('boundary result mismatch')
  }
  trace('PAIRING_XS_BOUNDARY_PASS\n')
  globalThis.testResult = 'pass'
} catch (e) {
  globalThis.testResult = String(e)
}
