import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const targets = {
      'stackchan-sdroot': './__tests__/sd-root-stub.mjs',
      'mod-files': '../../app/mod-files.ts',
    }
    if (targets[specifier]) return { url: new URL(targets[specifier], import.meta.url).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

test('board guard retries failed mounts, caches only success and restores LCD on every exit', async () => {
  const events = []
  const files = {
    openDirectory() {
      throw new Error('directory unavailable')
    },
  }
  globalThis.sdTest = { events, files, mounts: 0 }
  globalThis.native = (name) => () => {
    if (name.endsWith('_begin')) events.push('SD input')
    else if (name.endsWith('_end')) events.push('LCD output')
    else return new Uint8Array([17, 7, 17, 9]).buffer
  }
  const { default: card, withSDCard } = await import('./sd-card.ts')
  assert.throws(() => withSDCard(() => true), /no SD card/)
  assert.deepEqual(events.splice(0), ['SD input', 'LCD output'])
  assert.equal(
    withSDCard((root) => root),
    files,
  )
  assert.deepEqual(events.splice(0), ['SD input', 'LCD output'])
  assert.equal(globalThis.sdTest.mounts, 2)
  assert.throws(
    () =>
      withSDCard(() => {
        throw new Error('read error')
      }),
    /read error/,
  )
  assert.deepEqual(events.splice(0), ['SD input', 'LCD output'])
  assert.equal(globalThis.sdTest.mounts, 2, 'successful mount reused without rebootstrap')
  assert.throws(() => card.list(), /directory unavailable/)
  assert.deepEqual(events.splice(0), ['SD input', 'LCD output'])
  assert.deepEqual(card.xsVersionRange(), [17, 7, 17, 9])
})
