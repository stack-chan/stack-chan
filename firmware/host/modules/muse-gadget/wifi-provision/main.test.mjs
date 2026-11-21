import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function run(result, throws = false) {
  const events = []
  let tick, callback
  class WiFi {
    constructor(o) {
      events.push('wifi')
      if (throws) throw Error('private')
      callback = () => o.onChanged.call({ connection: 500 })
    }
    disconnect() {
      events.push('disconnect')
    }
    close() {
      events.push('wifi-close')
    }
  }
  const mods = {
    'embedded:network/interface/wifi': { default: WiFi },
    'muse-wifi-privacy': { default: () => events.push('silence') },
    'muse-wifi-provision': {
      open: () => events.push('open'),
      poll: () => result,
      connect: () => {
        events.push('connect')
        return true
      },
      close: () => events.push('close'),
    },
    timer: {
      default: {
        repeat: (f) => {
          tick = f
          return 1
        },
        set: () => 2,
        clear: () => {},
      },
    },
  }
  const context = vm.createContext({ trace: (s) => events.push(s.trim()) })
  const m = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), { context })
  await m.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(mods[name]),
        function () {
          for (const [k, v] of Object.entries(mods[name])) this.setExport(k, v)
        },
        { context },
      ),
  )
  await m.evaluate()
  tick()
  callback?.()
  return events
}
test('canary closes USB without constructing WiFi', async () => {
  const e = await run(2)
  assert.ok(e.includes('MUSE WIFI CANARY PASS'))
  assert.ok(!e.includes('wifi'))
  assert.ok(e.includes('close'))
})
test('saved account and fallback test connection through Moddable lifecycle', async () => {
  for (const result of [1, 4]) {
    const e = await run(result)
    assert.ok(e.includes('MUSE WIFI CONNECTED'))
    assert.ok(e.indexOf('silence') < e.indexOf('wifi'))
    assert.ok(e.includes('wifi-close'))
  }
})
test('WiFi constructor failure after save is contained and reported', async () => {
  const e = await run(1, true)
  assert.ok(e.includes('MUSE WIFI CONNECT FAILED'))
  assert.ok(e.includes('close'))
  assert.ok(!e.some((x) => x.includes('private')))
})
test('invalid USB frame never creates a WiFi connection', async () => {
  const e = await run(3)
  assert.ok(e.includes('MUSE WIFI REJECTED'))
  assert.ok(!e.includes('wifi'))
})
