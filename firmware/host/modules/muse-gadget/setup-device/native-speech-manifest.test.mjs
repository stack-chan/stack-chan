import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'))
test('native speech build isolates its output and bounds retained main-VM slot growth without changing other resources', async () => {
  const standard = await read('./manifest.json')
  const native = await read('./manifest-native-speech.json')
  assert.equal(native.build.NAME, 'muse-setup-native-speech-stopwatch')
  assert.equal(native.modules['muse-native-speech-enabled'], './native-speech-enabled')
  assert.equal(native.include[0], './manifest-native-speech-binding.json')
  const binding = await read(native.include.shift())
  assert.deepEqual(binding, { modules: { 'gemini-native-reader': '../../voice/gemini-native-reader' } })
  assert.ok(!native.include.includes('./manifest.json'))
  native.build.NAME = standard.build.NAME
  native.modules['muse-native-speech-enabled'] = './native-speech-disabled'
  assert.deepEqual(native.esp32Config, { CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY: 'y', CONFIG_MBEDTLS_HAVE_TIME_DATE: 'y' })
  assert.equal(native.creation.heap.incremental, 256)
  assert.equal(standard.creation.heap.incremental, 1024)
  native.creation.heap.incremental = standard.creation.heap.incremental
  delete native.esp32Config
  assert.deepEqual(native, standard)
})
test('offline fixture retains normal setup resources and disabled native speech', async () => {
  const standard = await read('./manifest.json')
  const offline = await read('./manifest.offline-test.json')
  assert.equal(offline.build.NAME, 'muse-cascaded-offline-test')
  assert.equal(offline.modules['muse-native-speech-enabled'], './native-speech-disabled')
  offline.build.NAME = standard.build.NAME
  offline.modules.main = standard.modules.main
  offline.modules['audio-in'] = standard.modules['audio-in']
  delete offline.modules['offline-heap']
  assert.deepEqual(offline, standard)
})
