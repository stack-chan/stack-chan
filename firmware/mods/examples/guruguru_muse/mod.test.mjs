import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { GuruguruAvatar } from '../guruguru_voice/avatar.js'

async function fixture({ available = true, missing = false, delayed = false } = {}) {
  const calls = [],
    balloons = []
  const avatar = new GuruguruAvatar()
  let events, release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const pipeline = {
    async start() {
      calls.push('start')
      if (delayed) await wait
    },
    async close(options) {
      calls.push(['close', options.mode])
      release()
    },
    async setMicrophoneMuted(value) {
      calls.push(['muted', value])
    },
    setVolume() {},
  }
  const modules = {
    modules: { default: { has: () => available, importNow: () => ({ createMuseVoiceConversation: () => ({}) }) } },
    preference: { default: { get: (_domain, key) => (missing && key === 'token' ? undefined : `fixture-${key}`) } },
    'guruguru-view': {
      createGuruguruView: () => ({
        model: avatar,
        content: {},
        close() {
          calls.push('view.close')
        },
      }),
    },
    'stackchan/voice': {
      VoiceScope: {
        create: () => ({
          signal: {},
          abort() {
            calls.push('abort')
          },
        }),
      },
      ConversationPipeline: {
        create(options) {
          assert.equal(options.microphoneMuted, true)
          calls.push('create')
          events = options.onEvent
          return pipeline
        },
      },
    },
  }
  const context = vm.createContext({})
  const mod = new vm.SourceTextModule(await readFile(new URL('./mod.js', import.meta.url), 'utf8'), { context })
  await mod.link((name) => {
    const exports = modules[name]
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
      },
      { context },
    )
  })
  await mod.evaluate()
  const oldA = () => {},
    oldB = () => {}
  const robot = {
    input: { button: { a: { onEvent: oldA }, b: { onEvent: oldB } } },
    audio: {},
    ui: {
      addEffect() {},
      removeEffect() {
        calls.push('remove')
      },
      showBalloon(value) {
        balloons.push(value)
      },
    },
  }
  mod.namespace.onContextCreated(robot)
  return {
    calls,
    balloons,
    avatar,
    robot,
    oldA,
    oldB,
    release,
    emit: (event) => events(event),
    press: (pressed) => robot.input.button.a.onEvent({ pressed }),
    stop: () => robot.input.button.b.onEvent({ pressed: true }),
    close: () => mod.namespace.onClose(),
    settle: () => new Promise(setImmediate),
  }
}

test('PTT uses public mute gate and mouth follows playback after settlement', async () => {
  const f = await fixture()
  f.press(true)
  await f.settle()
  assert.ok(f.calls.some((c) => c[0] === 'muted' && c[1] === false))
  assert.equal(f.avatar.state, 'listen')
  f.press(false)
  await f.settle()
  assert.ok(f.calls.some((c) => c[0] === 'muted' && c[1] === true))
  f.emit({ type: 'turn.started', turnId: 'turn' })
  f.emit({ type: 'turn.ended', turnId: 'turn' })
  f.emit({ type: 'output.level', value: 0.2 })
  assert.equal(f.avatar.state, 'speak')
  assert.ok(f.avatar.mouth > 0)
  f.emit({ type: 'output.level', value: 0 })
  assert.equal(f.avatar.mouth, 0)
  f.stop()
  await f.settle()
  assert.ok(f.calls.some((c) => c[0] === 'close' && c[1] === 'drain'))
  await f.close()
  assert.equal(f.robot.input.button.a.onEvent, f.oldA)
  assert.equal(f.robot.input.button.b.onEvent, f.oldB)
  assert.ok(f.calls.includes('view.close'))
  assert.ok(f.calls.includes('remove'))
})

test('missing host or settings starts no pipeline and exposes no setting values', async () => {
  for (const options of [{ available: false }, { missing: true }]) {
    const f = await fixture(options)
    f.press(true)
    await f.settle()
    assert.equal(f.calls.includes('create'), false)
    assert.equal(
      f.balloons.some((text) => text.includes('fixture-')),
      false,
    )
    assert.ok(f.balloons.some((text) => text.includes(options.missing ? 'token' : 'host')))
    await f.close()
  }
})

test('release while connecting never enables capture and close restores handlers', async () => {
  const f = await fixture({ delayed: true })
  f.press(true)
  f.press(false)
  f.release()
  await f.settle()
  assert.equal(
    f.calls.some((c) => c[0] === 'muted' && c[1] === false),
    false,
  )
  await f.close()
  assert.equal(f.robot.input.button.a.onEvent, f.oldA)
})

test('remote session end returns UI to idle and next press creates a fresh pipeline', async () => {
  const f = await fixture()
  f.press(true)
  await f.settle()
  f.emit({ type: 'session.ended', result: { reason: 'drained', remoteFinalization: 'confirmed' } })
  assert.equal(f.avatar.state, 'idle')
  f.press(true)
  await f.settle()
  assert.equal(f.calls.filter((value) => value === 'create').length, 2)
  await f.close()
})
