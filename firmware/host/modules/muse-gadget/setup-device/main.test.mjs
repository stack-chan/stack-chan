import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { isConnectionDiagnostic } from '../setup/conversation-owner.js'
import { createSetupCoordinator } from '../setup/coordinator.js'
import { createPairingController } from '../setup/pairing-controller.js'
import { describeSetupPrompt } from '../setup/prompt.js'
import * as speechProfile from '../speech-profile.js'
import * as speechProvider from '../speech-provider.js'
import * as captionLayout from './caption-layout.js'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(name, context, next) {
    if (name === 'muse-caption-layout') return next(new URL('./caption-layout.js', import.meta.url).href, context)
    return next(name, context)
  },
})
const { createCaptionState } = await import('./caption-state.js')
import { createResponseExpressionController } from './response-expression.js'
import { attachTalkButtons, createTalkControls } from './talk-controls.js'
import * as talkFeedback from './talk-feedback.js'

async function fixture(stored = false, metadataError = false, sdkReady = true, counterReady = true, lifecycle = {}) {
  const calls = [],
    labels = []
  const logs = []
  const expressions = []
  let onEvent
  let diagnostic
  const buttons = []
  class Button {
    constructor(options) {
      this.options = options
      this._pressed = buttons.length === 1 && Boolean(lifecycle.bootB)
      this.reads = 0
      buttons.push(this)
    }
    get pressed() {
      this.reads++
      return this._pressed
    }
    set pressed(value) {
      this._pressed = value
    }
    edge(pressed) {
      this.pressed = pressed
      this.options.onPush.call(this)
    }
    close() {
      this.closed = true
    }
  }
  let options
  class Content {
    constructor(_data, options = {}) {
      Object.assign(this, options)
      if (options.Behavior) this.behavior = new options.Behavior()
    }
    set coordinates(value) {
      for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height']) delete this[key]
      Object.assign(this, value)
    }
    captureTouch() {}
    start() {}
    stop() {}
    invalidate() {}
  }
  class Label extends Content {
    constructor(d, o) {
      super(d, o)
      if (o.Behavior) labels.push(this)
    }
  }
  class App extends Content {
    children = []
    add(child) {
      this.children.push(child)
    }
  }
  class Native {
    constructor() {
      calls.push('native')
    }
    close() {}
  }
  class Account {
    static restore() {
      calls.push('restore')
      const a = Object.create(Account.prototype)
      a.generation = 7
      return a
    }
    constructor() {
      calls.push('claim')
    }
    current() {
      return true
    }
    commitApproved() {
      calls.push('save')
      return { saved: true }
    }
    connectApproved() {
      calls.push('connect')
      if (lifecycle.connect) return lifecycle.connect()
      if (lifecycle.connected) return { connected: true }
      throw new Error('not connected')
    }
    close() {
      calls.push('account.close')
      return lifecycle.close?.()
    }
  }
  const modules = {
    modules: {
      default: {
        has: (name) => Boolean(lifecycle.rateFixture && name === 'muse-stopwatch-rate-fixture'),
        importNow(name, namespace) {
          assert.equal(name, 'muse-stopwatch-rate-fixture')
          if (lifecycle.rateFixtureImportFails) throw new Error('private import detail')
          // Moddable importNow defaults to the default export; the fixture only exports a named arm.
          if (!namespace) return undefined
          return { arm: ({ active }) => calls.push(active() ? 'fixture.armed' : 'fixture.blocked') }
        },
      },
    },
    timer: {
      default: { set: (callback, delay) => setTimeout(callback, delay), clear: (handle) => clearTimeout(handle) },
    },
    time: {
      default: {
        get ticks() {
          return Date.now()
        },
      },
    },
    'muse-caption-state': { createCaptionState },
    'muse-diagnostic-heap': {},
    'muse-speech-diagnostics': { createSpeechDiagnostics: () => ({ event() {}, close() {} }) },
    'muse-talk-feedback': talkFeedback,
    'muse-speech-profile': speechProfile,
    'muse-speech-provider': speechProvider,
    'muse-response-expression': { createResponseExpressionController },
    preference: { default: { get() {}, set() {} } },
    'muse-account-cascaded': { hasOpenAISpeechKey: () => true, hasGeminiSpeechKey: () => true },
    'muse-talk-controls': { createTalkControls, attachTalkButtons },
    'guruguru-view': {
      createGuruguruView() {
        return {
          content: new Content(null, { left: 0, right: 0, top: 0, bottom: 0 }),
          model: {
            setState() {},
            setLevel() {},
            setExpression(value) {
              expressions.push(value)
            },
          },
          close() {},
        }
      },
    },
    'muse-setup/conversation-runtime': {
      createSetupConversationRuntime(_event, _progress, onDiagnostic) {
        onEvent = _event
        diagnostic = onDiagnostic
        return {
          wrap: (account) => account,
          mute: async (value) => {
            calls.push(value ? 'mute' : 'record')
          },
          endCall: async () => {
            calls.push('endCall')
          },
        }
      },
    },
    'piu/MC': {
      Application: App,
      Container: Content,
      Behavior: class {},
      Label,
      Skin: class {
        constructor(options) {
          Object.assign(this, options)
        }
      },
      Style: class extends Content {
        measure(text) {
          return { width: text.length * 9 }
        }
      },
      Text: Content,
      Port: Content,
    },
    'muse-caption-layout': captionLayout,
    'muse-pairing-native': {
      default: Native,
      AccountSession: Account,
      pairingSelftest: () => ({ counter: counterReady, crypto: true }),
    },
    'muse-pairing/peripheral': {
      createPairingPeripheral(o) {
        options = o
        calls.push('radio')
        return {
          advertise() {
            calls.push('advertise')
          },
          async confirmPhysical() {
            calls.push('confirm')
            return true
          },
          close() {},
        }
      },
    },
    'muse-setup/conversation-owner': { isConnectionDiagnostic },
    'muse-setup/coordinator': { createSetupCoordinator },
    'muse-setup/prompt': { describeSetupPrompt },
    'muse-setup/pairing-controller': { createPairingController },
    'muse-native-speech-enabled': { default: false },
    'muse-setup-metadata': {
      default() {
        if (metadataError) throw new Error('hidden')
        return { sdkReady, setupComplete: stored, nodeId: 'homelink-abcdef', mac: '02:11:22:ab:cd:ef' }
      },
    },
  }
  const context = vm.createContext({
    device: { peripheral: { button: { A: Button, B: Button } } },
    trace(value) {
      logs.push(value)
    },
  })
  const main = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), { context })
  await main.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(modules[name]),
        function () {
          for (const [k, v] of Object.entries(modules[name])) this.setExport(k, v)
        },
        { context },
      ),
  )
  await main.evaluate()
  await new Promise((r) => setImmediate(r))
  return {
    logs,
    expressions,
    event: (event) => onEvent(event),
    buttons,
    diagnose: (value) => diagnostic(value),
    app: context.application,
    calls,
    get options() {
      return options
    },
    get secondary() {
      return labels[1]
    },
    async tapRepair(cancel = false) {
      const b = labels[1]
      b.behavior.onTouchBegan(b, 1, 0, 0, 0)
      if (cancel) b.behavior.onTouchCancelled()
      else b.behavior.onTouchEnded()
      await new Promise((r) => setImmediate(r))
    },
    async tap() {
      const b = labels[0]
      b.behavior.onTouchBegan(b, 1, 0, 0, 0)
      b.behavior.onTouchEnded()
      await new Promise((r) => setImmediate(r))
    },
  }
}
test('setup UI boot is radio inert; separate user actions gate confirmation and save', async () => {
  const f = await fixture()
  assert.deepEqual(f.calls, [])
  await f.tap()
  assert.deepEqual(f.calls, ['native', 'radio'])
  f.options.onReady()
  await new Promise((r) => setImmediate(r))
  assert.equal(f.calls.at(-1), 'advertise')
  f.options.onConfirmation()
  assert.ok(!f.calls.includes('confirm'))
  await f.tap()
  assert.equal(f.calls.at(-1), 'confirm')
  f.options.onProvision({ generation: 7, provisionReady: true })
  assert.equal(f.calls.at(-1), 'claim')
  assert.ok(!f.calls.includes('save'))
  await f.tap()
  assert.equal(f.calls.at(-1), 'save')
  assert.ok(!f.calls.includes('connect'))
})
test('stored credentials automatically connect once without saving or opening radio', async () => {
  const f = await fixture(true, false)
  assert.deepEqual(f.calls, ['restore', 'connect'])
})
test('unreadable metadata prevents radio construction', async () => {
  const f = await fixture(false, true)
  await f.tap()
  assert.deepEqual(f.calls, [])
})

test('missing SDK token keeps pairing disabled without opening radio', async () => {
  const f = await fixture(false, false, false)
  await f.tap()
  assert.deepEqual(f.calls, [])
})

test('setup root paints an opaque background even when avatar is hidden', async () => {
  const f = await fixture()
  assert.equal(f.app.skin.fill, 'black')
})

function rectangle(box) {
  const left = box.left ?? 466 - box.right - box.width
  const top = box.top ?? 466 - box.bottom - box.height
  return { left, top, width: box.width ?? 466 - left - box.right, height: box.height ?? 466 - top - box.bottom }
}
function overlaps(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}
test('visible status and actions stay inside the round screen without overlapping', async () => {
  for (const args of [[], [true], [false, true], [false, false, false]]) {
    const f = await fixture(...args)
    const visible = f.app.children.filter((child) => child.visible !== false && typeof child.left === 'number')
    assert.ok(visible.length >= 2)
    const boxes = visible.map(rectangle)
    for (const box of boxes) {
      for (const x of [box.left, box.left + box.width])
        for (const y of [box.top, box.top + box.height])
          assert.ok(Math.hypot(x - 233, y - 233) <= 217, 'visible UI crosses the 16px round-screen inset')
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) assert.equal(overlaps(boxes[i], boxes[j]), false)
    for (const child of visible.filter((child) => child.active)) assert.ok(child.height >= 44)
  }
})

test('shorter approval text still identifies credentials, destination and separate connection', async () => {
  const f = await fixture()
  await f.tap()
  f.options.onReady()
  await new Promise((r) => setImmediate(r))
  f.options.onConfirmation()
  await f.tap()
  f.options.onProvision({ generation: 7, provisionReady: true })
  const status = f.app.children.find((child) => child.height === 174)
  assert.match(status.string, /Save Wi-Fi and Muse credentials here/)
  assert.match(status.string, /does not connect/)
  assert.ok(status.string.length <= 110)
})

test('unsupported counter formatting blocks pairing before credential metadata or radio', async () => {
  const f = await fixture(false, false, true, false)
  await f.tap()
  assert.deepEqual(f.calls, [])
})

test('saved account can pair again without changing storage until the next explicit Save', async () => {
  const f = await fixture(true)
  assert.equal(f.secondary.visible, true)
  assert.equal(f.secondary.string, '\u30da\u30a2\u30ea\u30f3\u30b0')
  assert.ok(f.calls.includes('connect'))
  await f.tapRepair()
  assert.deepEqual(f.calls, ['restore', 'connect', 'account.close', 'native', 'radio'])
  f.options.onReady()
  await new Promise((r) => setImmediate(r))
  f.options.onConfirmation()
  await f.tap()
  f.options.onProvision({ generation: 9, provisionReady: true })
  assert.equal(f.calls.includes('save'), false)
  await f.tap()
  assert.equal(f.calls.filter((x) => x === 'save').length, 1)
  assert.equal(f.calls.filter((x) => x === 'connect').length, 1)
})

test('repair awaits old owner shutdown and coalesces repeated touches', async () => {
  let finish
  const f = await fixture(true, false, true, true, {
    close: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  await f.tapRepair()
  await f.tapRepair()
  assert.deepEqual(f.calls, ['restore', 'connect', 'account.close'])
  finish()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'account.close', 'native', 'radio'])
})

test('quit during repair shutdown prevents new pairing; cancellation does not start it', async () => {
  let finish
  const f = await fixture(true, false, true, true, {
    close: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  await f.tapRepair(true)
  assert.deepEqual(f.calls, ['restore', 'connect'])
  await f.tapRepair()
  f.app.behavior.onQuit()
  finish()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'account.close'])
})

test('saved account without SDK token cannot restart pairing', async () => {
  const f = await fixture(true, false, false)
  assert.equal(f.secondary.visible, false)
  await f.tapRepair()
  assert.deepEqual(f.calls, ['restore'])
})

test('re-pairing after a fresh Save closes the controller-owned account and fences old callbacks', async () => {
  const f = await fixture()
  await f.tap()
  f.options.onReady()
  await new Promise((r) => setImmediate(r))
  f.options.onConfirmation()
  await f.tap()
  f.options.onProvision({ generation: 7, provisionReady: true })
  await f.tap()
  const previous = f.options
  const count = f.calls.length
  await f.tapRepair()
  assert.deepEqual(f.calls.slice(count), ['account.close', 'native', 'radio'])
  previous.onProvision({ generation: 8, provisionReady: true })
  assert.equal(f.calls.filter((x) => x === 'claim').length, 1)
  assert.equal(f.calls.filter((x) => x === 'save').length, 1)
})

test('MUSE_CONNECT traces accept only exact fixed diagnostic markers', async () => {
  const f = await fixture()
  f.logs.length = 0
  f.diagnose('network_start')
  f.diagnose('account_refresh_rejected')
  f.diagnose('token=private')
  f.diagnose('network_start\nSSID=private')
  f.diagnose({ type: 'error', message: 'private' })
  assert.deepEqual(f.logs, ['MUSE_CONNECT network_start\n', 'MUSE_CONNECT account_refresh_rejected\n'])
})

test('advertising screen shows the actual identity-derived BLE name', async () => {
  const f = await fixture()
  await f.tap()
  f.options.onReady()
  await new Promise((r) => setImmediate(r))
  const status = f.app.children.find((child) => child.height === 174)
  assert.equal(f.options.name, 'MuseGadget-ABCDEF')
  assert.ok(status.string.includes(f.options.name))
  assert.equal(status.string.includes('MuseGadgetStopWatch'), false)
})

test('A hold/release sends once after automatic connection', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  assert.deepEqual(f.calls, ['restore', 'connect'])
  f.buttons[0].edge(true)
  f.buttons[0].edge(true)
  await new Promise((r) => setImmediate(r))
  f.buttons[0].edge(false)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'record', 'mute'])
})

test('physical B aborts held recording without submitting and quit closes GPIO', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  f.buttons[0].edge(true)
  await new Promise((r) => setImmediate(r))
  f.buttons[1].edge(true)
  f.buttons[1].edge(true)
  f.buttons[0].edge(false)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'record', 'endCall'])
  f.app.behavior.onQuit()
  assert.ok(f.buttons.every((button) => button.closed))
})

test('B held at boot selects pairing menu without restoring, connecting, saving or deleting', async () => {
  const f = await fixture(true, false, true, true, { bootB: true, connected: true })
  assert.deepEqual(f.calls, [])
  assert.equal(f.buttons[1].reads, 1)
  assert.equal(f.app.children[2].string, 'Start pairing')
  f.buttons[1].edge(false)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, [])
  await f.tap()
  assert.deepEqual(f.calls, ['native', 'radio'])
  assert.equal(f.calls.includes('save'), false)
})

test('normal B disconnect does not trigger automatic reconnect or pairing', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  assert.equal(f.buttons[1].reads, 1)
  f.buttons[1].edge(true)
  await new Promise((r) => setImmediate(r))
  f.buttons[1].edge(false)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'endCall'])
  assert.equal(f.app.children[2].string, 'Connect to Muse')
})

test('quit fences completion of an in-flight automatic connection', async () => {
  let complete
  const f = await fixture(true, false, true, true, {
    connect: () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  })
  assert.deepEqual(f.calls, ['restore', 'connect'])
  f.app.behavior.onQuit()
  complete({ connected: true })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.calls, ['restore', 'connect', 'account.close'])
  assert.notEqual(f.app.children[2].string, 'Disconnect')
})

test('connected subtitles overlay the lower part of the centered avatar inside the round screen', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  const [avatar, status, action, talk] = f.app.children
  assert.equal(action.visible, false)
  assert.equal(action.active, false)
  assert.equal(talk.visible, false)
  assert.equal(talk.active, false)
  const caption = rectangle(status)
  const face = rectangle(avatar)
  assert.equal(avatar.visible, true)
  assert.deepEqual(face, { left: 0, top: 0, width: 466, height: 466 })
  assert.ok(caption.top >= face.top + face.height / 2)
  assert.ok(overlaps(caption, face))
  const meter = f.app.children.find((child) => child.interval === 100)
  assert.ok(meter)
  assert.equal(overlaps(caption, rectangle(meter)), false)
  assert.equal(status.skin, undefined)
  assert.equal(status.clip, true)
  const rows = status.contents.slice(1)
  assert.equal(rows.length, 2)
  for (const row of rows)
    for (const x of [status.left + row.left, status.left + row.left + row.width])
      for (const y of [caption.top + row.top, caption.top + row.top + row.height])
        assert.ok(Math.hypot(x - 233, y - 233) <= 225, 'subtitle text crosses the round screen')
  f.buttons[1].edge(true)
  await new Promise((r) => setImmediate(r))
  assert.equal(action.visible, true)
  assert.equal(action.active, true)
  assert.equal(talk.visible, true)
  assert.equal(talk.active, true)
  assert.equal(talk.string, '\u30da\u30a2\u30ea\u30f3\u30b0')
  assert.equal(status.top, talkFeedback.savedStatusBounds.top)
  assert.equal(status.height, talkFeedback.savedStatusBounds.height)
  assert.equal(status.bottom, undefined)
  assert.equal(status.skin, undefined)
})

test('pressing A during a reply leaves the current turn alone', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  const [a] = f.buttons
  f.event({ type: 'turn.started', turnId: 'one' })
  a.edge(true)
  a.edge(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.calls, ['restore', 'connect'])

  f.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  a.edge(true)
  a.edge(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.calls, ['restore', 'connect', 'record', 'mute'])
})

test('complete response content selects an expression and shutdown clears it', async () => {
  const f = await fixture(true, false, true, true, { connected: true })
  f.event({ type: 'turn.started' })
  f.event({ type: 'output.text', delta: 'Congratulations!' })
  assert.deepEqual(f.expressions, ['happy'])
  f.event({ type: 'turn.ended' })
  assert.deepEqual(f.expressions, ['happy', 'neutral'])
  f.event({ type: 'turn.started' })
  f.event({ type: 'output.text', delta: 'I am sorry to hear that.' })
  f.event({ type: 'session.ended' })
  assert.deepEqual(f.expressions, ['happy', 'neutral', 'sad', 'neutral'])
})

test('speech failures expose only bounded diagnostic codes, never error details', async () => {
  const f = await fixture(true)
  f.logs.length = 0
  f.event({ type: 'error', code: 'deadline_exceeded', fatal: false, message: 'private text' })
  f.event({ type: 'error', code: 'resource_exhausted', fatal: false })
  f.event({ type: 'error', code: 'private token', fatal: false })
  assert.deepEqual(f.logs, [
    'MUSE_SPEECH error deadline_exceeded\n',
    'MUSE_SPEECH error resource_exhausted\n',
    'MUSE_SPEECH error unknown\n',
  ])
})

test('TTS metrics traces accept bounded digits only and reject injected strings', async () => {
  const f = await fixture()
  f.logs.length = 0
  f.diagnose('tts_metrics_123456_12345678')
  for (const value of [
    'tts_metrics_1234567_1',
    'tts_metrics_1_123456789',
    'tts_metrics_1_2\nsecret',
    'tts_metrics_secret_1',
    'tts_metrics_-1_2',
  ])
    f.diagnose(value)
  assert.deepEqual(f.logs, ['MUSE_SPEECH tts_metrics_123456_12345678\n'])
})

test('TTS failure traces accept only the fixed category range', async () => {
  const f = await fixture()
  f.logs.length = 0
  for (const value of [
    'tts_failure_0',
    'tts_failure_13',
    'tts_failure_14',
    'tts_failure_secret',
    'tts_failure_1\nsecret',
  ])
    f.diagnose(value)
  assert.deepEqual(f.logs, ['MUSE_SPEECH tts_failure_0\n', 'MUSE_SPEECH tts_failure_13\n'])
})

test('transport diagnostics accept ten bounded numeric fields only', async () => {
  const f = await fixture()
  f.logs.length = 0
  f.diagnose('tts_transport_1_0_200_100_0_100_20_10_10_0')
  f.diagnose('tts_transport_private')
  f.diagnose('tts_transport_1_0_200_100_0_100_20_10_10_0\nsecret')
  assert.deepEqual(f.logs, ['MUSE_SPEECH tts_transport_1_0_200_100_0_100_20_10_10_0\n'])
})

test('STT trace allows only PCM byte count and four elapsed times', async () => {
  const f = await fixture()
  f.logs.length = 0
  for (const value of [
    'stt_timing_48000_12_17_200_1',
    'stt_timing_1_2_3_4',
    'stt_timing_1_2_3_4_text',
    'stt_timing_1_2_3_4_5\nsecret',
  ])
    f.diagnose(value)
  assert.deepEqual(f.logs, ['MUSE_SPEECH stt_timing_48000_12_17_200_1\n'])
})

test('chat connection diagnostics never log arbitrary provider detail', async () => {
  const f = await fixture()
  f.logs.length = 0
  for (const code of ['note_connect_open_7', 'note_transport_reason_23', 'note_connect_open_8', 'note_transport_reason_24', 'note_connect_open_private', 'note_connect_start_failed\nprivate']) f.diagnose(code)
  assert.deepEqual(f.logs, ['MUSE_CONNECT note_connect_open_7\n', 'MUSE_CONNECT note_transport_reason_23\n'])
})

test('reply and worker lifecycle diagnostics reject arbitrary text and appended details', async () => {
  const f = await fixture()
  f.logs.length = 0
  const accepted = ['note_subscription_body', 'note_reply_event', 'note_subscription_end', 'note_reply_complete', 'tts_worker_start', 'tts_worker_allocation_failed', 'tts_worker_spawned', 'tts_worker_dispatch', 'tts_worker_done', 'tts_worker_error']
  for (const marker of accepted) {
    f.diagnose(marker)
    f.diagnose(marker + '\nprivate')
  }
  f.diagnose('tts_worker_private')
  f.diagnose('note_reply_private')
  assert.equal(f.logs.length, accepted.length)
  assert.ok(f.logs.every(x => !x.includes('private')))
})

test('compiled offline rate fixture arms after setup and neither restores account nor connects', async () => {
  const f = await fixture(true, false, true, true, { connected: true, rateFixture: true })
  assert.ok(f.calls.includes('fixture.armed'))
  assert.ok(!f.calls.includes('restore'))
  assert.ok(!f.calls.includes('connect'))
  assert.ok(f.logs.includes('MUSE_RATE_APP_READY\n'))
})

test('offline rate fixture never arms when normal startup self-test fails', async () => {
  const f = await fixture(true, false, true, false, { connected: true, rateFixture: true })
  assert.ok(!f.calls.includes('fixture.armed'))
  assert.ok(!f.calls.includes('connect'))
  assert.ok(!f.logs.includes('MUSE_RATE_APP_READY\n'))
})

test('offline fixture import failure emits only sanitized marker and does not connect', async () => {
  const f = await fixture(true, false, true, true, { connected: true, rateFixture: true, rateFixtureImportFails: true })
  assert.ok(f.logs.includes('MUSE_RATE_INIT_FAILED\n'))
  assert.ok(f.logs.every((line) => !line.includes('private import detail')))
  assert.ok(!f.calls.includes('fixture.armed'))
  assert.ok(!f.calls.includes('restore'))
  assert.ok(!f.calls.includes('connect'))
})
