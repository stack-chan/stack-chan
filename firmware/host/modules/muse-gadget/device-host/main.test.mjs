import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function fixture({ missing = false, wifiSettings, privacyFailure = false } = {}) {
  const labels = [],
    logs = [],
    buttons = [],
    connections = [],
    times = []
  let wifi, ntpCallback
  class Content {
    constructor(data, options = {}) {
      Object.assign(this, options)
      if (options.Behavior) {
        this.behavior = new options.Behavior()
        this.behavior.onCreate?.(this, data)
      }
    }
    captureTouch() {}
  }
  class Label extends Content {
    constructor(data, options) {
      super(data, options)
      labels.push(this)
    }
  }
  class Application extends Content {
    add() {}
    remove() {}
  }
  class WiFi {
    constructor(options) {
      this.callback = options.onChanged
      wifi = this
    }
    connect(options) {
      connections.push(options)
    }
    close() {}
  }
  class NTP {
    getTime(callback) {
      ntpCallback = callback
    }
    close() {}
  }
  const exports = {
    'muse-wifi-privacy': {
      default() {
        if (privacyFailure) throw new Error('privacy unavailable')
      },
    },
    'piu/MC': { Application, Behavior: class {}, Label, Skin: Content, Style: Content, Text: Content },
    'embedded:network/interface/wifi': { default: WiFi },
    preference: {
      default: {
        get: (domain, key) => {
          if (wifiSettings && domain !== 'muse') return wifiSettings[domain]?.[key]
          return missing && key === 'token' ? undefined : `fixture-${key}`
        },
      },
    },
    time: { default: { set: (value) => times.push(value) } },
    'stackchan/voice/device': { createAudioRuntime: () => ({ microphone: {}, speaker: {} }) },
    'guruguru-muse-mod': {
      onContextCreated(robot) {
        for (const key of ['a', 'b']) robot.input.button[key].onEvent = (event) => buttons.push([key, event.pressed])
      },
      async onClose() {},
    },
  }
  const context = vm.createContext({
    trace: (value) => logs.push(value),
    device: { network: { ntp: { client: { io: NTP } } } },
  })
  const mod = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), { context })
  await mod.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(exports[name]),
        function () {
          for (const [key, value] of Object.entries(exports[name])) this.setExport(key, value)
        },
        { context },
      ),
  )
  await mod.evaluate()
  return {
    logs,
    connections,
    buttons,
    times,
    connect() {
      wifi.connection = 500
      wifi.callback.call(wifi)
    },
    sync(error, time) {
      ntpCallback(error, time)
    },
    press() {
      const button = labels[0]
      button.behavior.onTouchBegan(button, 1, 100, 350, 0)
    },
  }
}

test('missing preference prevents all network activity and logs only presence', async () => {
  const f = await fixture({ missing: true })
  assert.equal(f.connections.length, 0)
  f.press()
  assert.equal(f.buttons.length, 0)
  const values = JSON.parse(f.logs[0].slice(f.logs[0].indexOf('{')))
  assert.equal(Object.keys(values).length, 7)
  assert.equal(values['muse.token'], false)
  assert.ok(Object.values(values).every((value) => typeof value === 'boolean'))
  assert.equal(f.logs.join('').includes('fixture-'), false)
})

test('PTT stays disabled until real time synchronization succeeds', async () => {
  const f = await fixture()
  assert.equal(f.connections.length, 1)
  f.press()
  assert.equal(f.buttons.length, 0)
  f.connect()
  f.press()
  assert.equal(f.buttons.length, 0)
  f.sync(null, 1800000000000)
  assert.deepEqual(f.times, [1800000000])
  f.press()
  assert.deepEqual(f.buttons, [['a', true]])
  assert.equal(f.logs.join('').includes('fixture-'), false)
})

test('time synchronization failure never permits a call', async () => {
  const f = await fixture()
  f.connect()
  f.sync(new Error('test'), undefined)
  f.press()
  assert.equal(f.buttons.length, 0)
  assert.equal(f.times.length, 0)
})

test('standalone manifest includes dynamic module loader and catches entry failure', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.include.includes('$(MODDABLE)/modules/base/modules/manifest.json'))
  assert.equal(manifest.modules.main, './boot')
  assert.equal(manifest.modules['muse-host-main'], './main')
  const source = await readFile(new URL('./boot.js', import.meta.url), 'utf8')
  const logs = []
  const context = vm.createContext({ trace: (line) => logs.push(line) })
  const modules = new vm.SyntheticModule(
    ['default'],
    function () {
      this.setExport('default', {
        importNow() {
          throw new Error('secret configuration value')
        },
        has() {
          return true
        },
      })
    },
    { context },
  )
  const entry = new vm.SourceTextModule(source, { context })
  await entry.link(() => modules)
  await entry.evaluate()
  assert.ok(logs.some((line) => line.includes('init_failed Error')))
  assert.ok(logs.every((line) => !line.includes('secret')))
})

test('complete primary WiFi takes priority without combining namespaces', async () => {
  const f = await fixture({
    wifiSettings: {
      wifi: { ssid: 'primary', password: 'primary-pass' },
      alloywifi: { ssid: 'fallback', password: 'fallback-pass' },
    },
  })
  assert.equal(f.connections[0].SSID, 'primary')
  assert.equal(f.connections[0].password, 'primary-pass')
})
test('incomplete primary WiFi uses only complete fallback pair', async () => {
  const f = await fixture({
    wifiSettings: { wifi: { ssid: 'primary' }, alloywifi: { ssid: 'fallback', password: 'fallback-pass' } },
  })
  assert.equal(f.connections[0].SSID, 'fallback')
  assert.equal(f.connections[0].password, 'fallback-pass')
  assert.ok(!f.logs.join('').includes('fallback'))
})
test('partial pairs do not combine and missing Muse prevents fallback connection', async () => {
  const partial = await fixture({
    wifiSettings: { wifi: { ssid: 'primary' }, alloywifi: { password: 'fallback-pass' } },
  })
  assert.equal(partial.connections.length, 0)
  const noMuse = await fixture({
    missing: true,
    wifiSettings: { alloywifi: { ssid: 'fallback', password: 'fallback-pass' } },
  })
  assert.equal(noMuse.connections.length, 0)
})

test('privacy setup failure prevents WiFi construction and connection', async () => {
  const f = await fixture({ privacyFailure: true })
  assert.equal(f.connections.length, 0)
  assert.ok(!f.logs.join('').includes('privacy unavailable'))
})
