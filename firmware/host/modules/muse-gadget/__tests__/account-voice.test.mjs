import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
async function load(file, globals, exports) {
  const source = (await readFile(new URL(file, root), 'utf8'))
    .replace(/^import .*\n/gm, '')
    .replaceAll('export default class ', 'class ')
    .replaceAll('export function ', 'function ')
  return vm.runInNewContext(source + `\n;({${exports}})`, globals)
}
test('account factory passes opaque owner only at native open and defaults official app ID', async () => {
  const owner = Object.freeze({}),
    calls = []
  const { createMuseAccountVoiceConversation } = await load(
    'voice-account-client.js',
    {
      MuseAccountNative: class {
        constructor(...args) {
          calls.push(args)
        }
      },
      createMuseVoiceConversationWithNative(configuration, open) {
        return { configuration, open }
      },
    },
    'createMuseAccountVoiceConversation',
  )
  const result = createMuseAccountVoiceConversation(owner, { nodeId: 'test-node' })
  assert.equal(calls.length, 0)
  assert.deepEqual(Object.keys(result.configuration), ['nodeId'])
  const callback = () => {}
  result.open({}, callback)
  assert.equal(calls[0][0], owner)
  assert.equal(calls[0][1], callback)
  assert.equal(calls[0][2], 'hatch-web')
})
test('legacy and account native constructors preserve shared callback/method contract', async () => {
  const calls = []
  const globals = {
    Native: () => class {},
    native: (name) =>
      function (...args) {
        calls.push([name, this, ...args])
      },
  }
  const { MuseNativeTransport } = await load('native/transport.js', globals, 'MuseNativeTransport')
  const { MuseNative } = await load('native/muse-native.js', { ...globals, MuseNativeTransport }, 'MuseNative')
  const { MuseAccountNative } = await load(
    'native/account-voice.js',
    { ...globals, MuseNativeTransport },
    'MuseAccountNative',
  )
  const callback = () => {},
    old = new MuseNative({ host: 'fixture', vmId: 'vm', token: 'fixture-only' }, callback),
    owner = {}
  const modern = new MuseAccountNative(owner, callback, 'hatch-web')
  assert.equal(old.onEvent, callback)
  assert.equal(modern.onEvent, callback)
  assert.equal(calls[0][0], 'xs_muse_constructor')
  assert.equal(calls[1][0], 'xs_muse_account_constructor')
  assert.equal(calls[1][2], owner)
  modern.start()
  old.close()
  assert.equal(calls[2][0], 'xs_muse_start')
  assert.equal(calls[3][0], 'xs_muse_close')
})
