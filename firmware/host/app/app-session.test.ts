import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AppContext } from '../../sdk/app.js'
import { StackchanError } from '../../sdk/errors.js'
import type { AppLighting } from '../../sdk/extensions/lighting.js'
import type { PiuAppDefinition, ScreenContext } from '../../sdk/extensions/piu.js'
import type { AppSettings } from '../../sdk/extensions/settings.js'
import type { AppUI } from '../../sdk/extensions/ui.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { AppServiceScope } from './app-service-scope.js'
import type { AppPorts } from './app-session.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackageSubpath(resolve(hostRoot, '..'), 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackage(resolve(hostRoot, '..'), 'stackchan', resolve(hostRoot, '../sdk/app.js'))
  for (const name of ['input', 'ui', 'lighting', 'conversation', 'network'])
    for (const directory of [hostRoot, resolve(hostRoot, '..')])
      writeAliasPackageSubpath(
        directory,
        'stackchan',
        `extensions/${name}`,
        resolve(hostRoot, `../sdk/extensions/${name}.js`),
      )
  for (const name of ['owned-resources', 'cancellation', 'task-scope', 'app-service-scope', 'app-dialogue']) {
    writeAliasPackage(hostRoot, name, resolve(hostRoot, `app/${name}.js`))
  }
  writeAliasPackage(hostRoot, 'modules', resolve(hostRoot, 'modules/testing/fakes/modules.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(hostRoot, 'mcp-client', resolve(hostRoot, 'modules/connectivity/mcp-client/mcp-client.js'))
  const { AppSession } = await import('./app-session.js')
  const { AppConnection } = await import('./app-service-scope.js')
  const { OperationQueue } = await import('./operation-queue.js')
  const { defineApp } = await import('../../sdk/app.js')
  return { AppSession, AppConnection, OperationQueue, defineApp }
}

class Clock {
  now = 0
  jobs = new Set<() => void>()
  due = new Map<() => void, number>()
  after(ms: number, callback: () => void): () => void {
    this.jobs.add(callback)
    this.due.set(callback, this.now + ms)
    return () => {
      this.jobs.delete(callback)
      this.due.delete(callback)
    }
  }
  tick(): void {
    for (const job of [...this.jobs])
      if (this.jobs.delete(job)) {
        this.due.delete(job)
        job()
      }
  }
  async advance(ms: number): Promise<void> {
    const end = this.now + ms
    await flush()
    for (;;) {
      const next = [...this.due].sort((a, b) => a[1] - b[1])[0]
      if (!next || next[1] > end) break
      this.now = next[1]
      this.due.delete(next[0])
      this.jobs.delete(next[0])
      next[0]()
      await flush()
    }
    this.now = end
    await flush()
  }
}

const flush = async () => {
  for (let i = 0; i < 16; i += 1) await Promise.resolve()
}

function fixture() {
  const clock = new Clock()
  const presses = new Set<() => void>()
  const errors: unknown[] = []
  const ports: AppPorts = {
    motion: {
      info: { availability: 'unavailable', reason: 'No test motion device' },
      async move() {
        throw new Error('No test motion device')
      },
      lookAt() {},
      lookAway() {},
      async stop() {},
      async hold() {},
      async relax() {},
      async close() {},
    },
    face: { setEmotion() {}, setMouthOpen() {}, setColor() {} },
    audio: {
      async say() {},
      async tone() {},
      async playClip() {},
      async close() {},
      async play() {},
      async record() {
        throw new Error('recording is not configured in this test')
      },
    },
    input: {
      subscribePress: (handler) => {
        presses.add(handler)
        return () => {
          presses.delete(handler)
        }
      },
    },
    ui: { showBalloon() {}, hideBalloon() {}, showImage() {}, hideImage() {} },
    camera: {
      info: { availability: 'unavailable', reason: 'test', formats: [] },
      async capture() {
        throw new Error('unavailable')
      },
      async close() {},
    },
    capabilities: { get: () => ({ availability: 'simulated' }) },
  }
  return { clock, presses, errors, ports }
}

function controlsFixture() {
  const f = fixture()
  const items = new Map<string, { value?: string | boolean; select(value?: string): void }>()
  let resets = 0
  f.ports.controls = {
    faceStyle: 'default',
    closeMenu() {},
    setFaceStyle() {},
    setImageAvatar() {},
    setHandAnimation() {},
    setEmoticon() {},
    localize: (key) => key,
    resetAppearance() {
      resets++
    },
    registerMenu(view, select) {
      const item = { value: view.value, select }
      items.set(view.id, item)
      return {
        setValue(value) {
          item.value = value
        },
        close() {
          items.delete(view.id)
        },
      }
    },
  }
  return { ...f, items, resets: () => resets }
}

test('the avatar example shares selection, owns appearance and cannot react after closing', async () => {
  const { AppSession } = await setup()
  const { default: definition } = await import('../../mods/examples/image_avatar_lite/mod.js')
  const { IMAGE_AVATAR_LITE_PACKS } = await import('../../mods/examples/image_avatar_lite/image-avatar-lite-packs.js')
  const { EMOTIONS } = await import('../../sdk/app.js')
  const f = controlsFixture()
  const selected: string[] = []
  const emotions: string[] = []
  const controls = f.ports.controls
  assert.ok(controls)
  controls.setImageAvatar = (pack) => {
    selected.push(pack.id)
  }
  f.ports.face.setEmotion = (emotion) => {
    emotions.push(emotion)
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(definition)
  const choice = f.items.get('avatar')
  const emotionAction = f.items.get('avatar-emotion')
  assert.ok(choice)
  assert.ok(emotionAction)
  const changeEmotion = emotionAction.select
  const press = [...f.presses][0]
  const ids = Object.keys(IMAGE_AVATAR_LITE_PACKS)
  assert.equal(selected[0], ids[0])
  for (let i = 1; i <= ids.length; i++) {
    press()
    await flush()
    assert.equal(selected.at(-1), ids[i % ids.length])
    assert.equal(choice.value, selected.at(-1))
  }
  choice.select(ids[3])
  await flush()
  assert.equal(selected.at(-1), ids[3])
  press()
  await flush()
  assert.equal(selected.at(-1), ids[4], 'button continues from the menu selection')
  for (let i = 0; i < EMOTIONS.length; i++) {
    changeEmotion()
    await flush()
  }
  assert.deepEqual(emotions, [...EMOTIONS.slice(1), EMOTIONS[0]])
  const beforeFailure = choice.value
  controls.setImageAvatar = () => {
    throw new Error('missing PNG')
  }
  press()
  await flush()
  assert.equal(choice.value, beforeFailure, 'failed selection leaves the menu at the last displayed pack')
  assert.equal(f.errors.length, 1)
  await session.close()
  const calls = selected.length
  press()
  choice.select(ids[0])
  changeEmotion()
  await flush()
  assert.equal(selected.length, calls)
  assert.equal(emotions.length, EMOTIONS.length)
  assert.equal(f.presses.size, 0)
  assert.equal(f.items.size, 0)
  assert.equal(f.resets(), 1)
  assert.equal(session.resourceCount, 0)
  assert.equal(session.taskCount, 0)
})

test('the petting deadline cancels a slow motion and manual stop cancels its later restoration', async () => {
  const { AppSession } = await setup()
  const { installCompanion } = await import('./default-app/companion.js')
  const f = controlsFixture()
  let touch: Parameters<NonNullable<AppPorts['input']['subscribeHeadTouch']>>[0] | undefined
  f.ports.input.subscribeHeadTouch = (handler) => {
    touch = handler
    return () => {
      touch = undefined
    }
  }
  f.ports.capabilities.get = (id) =>
    id === 'input.headTouch' ? { availability: 'simulated' } : { availability: 'unavailable', reason: 'unused' }
  const events: { action: string; at: number }[] = []
  let slow = true
  f.ports.motion = {
    ...f.ports.motion,
    info: { availability: 'simulated', canRelax: false, feedback: 'estimated', yawDeg: [-60, 60], pitchDeg: [-45, 30] },
    async move(_target, options) {
      events.push({ action: 'move', at: f.clock.now })
      if (slow)
        await new Promise<void>((_resolve, reject) =>
          options.signal?.subscribe((error) => {
            events.push({ action: 'cancel', at: f.clock.now })
            reject(error)
          }),
        )
      return { completion: 'estimated' }
    },
    async stop() {
      events.push({ action: 'stop', at: f.clock.now })
    },
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let companion: ReturnType<typeof installCompanion> | undefined
  await session.start({
    apiVersion: 2,
    setup(app) {
      companion = installCompanion(app, { react() {} })
    },
  })
  const pet = async () => {
    assert.ok(touch)
    touch({ gesture: 'forwardSwipe' })
    await flush()
    touch({ gesture: 'backwardSwipe' })
    await flush()
    await f.clock.advance(0)
  }
  await pet()
  await f.clock.advance(4999)
  assert.deepEqual(events, [{ action: 'move', at: 0 }])
  slow = false
  await f.clock.advance(1)
  assert.deepEqual(events, [
    { action: 'move', at: 0 },
    { action: 'cancel', at: 5000 },
    { action: 'move', at: 5000 },
    { action: 'stop', at: 5000 },
  ])
  slow = true
  await pet()
  assert.ok(companion)
  await companion.stop()
  const stopped = events.length
  await f.clock.advance(6000)
  assert.equal(events.length, stopped, 'a stopped reaction never restores an old pose later')
  f.ports.motion.move = async () => {
    events.push({ action: 'failed', at: f.clock.now })
    throw new Error('motion failed')
  }
  await pet()
  const failed = events.length
  await f.clock.advance(6000)
  assert.equal(events.length, failed, 'a failed reaction never retries motion at the old deadline')
  assert.equal(f.errors.length, 1)
  assert.ok(f.errors[0] instanceof StackchanError)
  assert.equal(f.errors[0].code, 'IO')
  await session.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('menu subscriptions and delayed tasks cancel together without reentry or retained registrations over 100 lifetimes', async () => {
  const { AppSession, defineApp } = await setup()
  for (let cycle = 0; cycle < 100; cycle++) {
    const f = controlsFixture()
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await session.start(defineApp({ setup() {} }))
    const view = session.context.ui as AppUI
    let calls = 0
    const remove = view.addAction({ id: 'work', label: 'Work' }, async (task) => {
      calls++
      await task.sleep(100)
      calls++
    })
    const item = f.items.get('work')
    assert.ok(item)
    const select = item.select
    select()
    select()
    await flush()
    assert.equal(calls, 1)
    remove()
    select()
    session.context.time.after(50, () => {
      calls++
    })
    await session.close()
    f.clock.tick()
    await flush()
    assert.equal(calls, 1)
    assert.equal(f.items.size, 0)
    assert.equal(f.clock.jobs.size, 0)
    assert.equal(session.resourceCount, 0)
    assert.equal(session.taskCount, 0)
    assert.deepEqual(f.errors, [])
  }
})

test('a one-shot timer relinquishes its registration after completion and its disposer cancels an active handler', async () => {
  const { AppSession } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let calls = 0
  session.context.time.after(10, () => {
    calls++
  })
  await flush()
  f.clock.tick()
  await flush()
  f.clock.tick()
  await flush()
  assert.equal(calls, 1)
  assert.equal(session.resourceCount, 0)
  const remove = session.context.time.after(0, async (task) => {
    calls++
    await task.sleep(100)
    calls++
  })
  await flush()
  f.clock.tick()
  await flush()
  assert.equal(calls, 2)
  remove()
  await flush()
  f.clock.tick()
  await flush()
  assert.equal(calls, 2)
  assert.equal(f.clock.jobs.size, 0)
  await session.close()
})

test('menu choices preserve external edits, roll back rejected selections and snapshot their allowed values', async () => {
  const { AppSession } = await setup()
  const f = controlsFixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  const view = session.context.ui as AppUI
  const choices = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' },
  ]
  let failure = false
  const control = view.addChoice(
    { id: 'choice', label: 'Choice', value: 'one', options: choices },
    async (_value, task) => {
      await task.sleep(10)
      if (failure) throw new Error('update failed')
    },
  )
  const item = f.items.get('choice')
  assert.ok(item)
  choices[0].value = 'mutated'
  assert.throws(() => control.setValue('mutated'), { code: 'INVALID_ARGUMENT' })
  item.select('two')
  await flush()
  control.setValue('one')
  f.clock.tick()
  await flush()
  assert.equal(item.value, 'one', 'later app changes win over stale handler completion')
  failure = true
  item.select('two')
  await flush()
  f.clock.tick()
  await flush()
  assert.equal(item.value, 'one')
  assert.equal(f.errors.length, 1)
  assert.throws(() => view.addAction({ id: 'choice', label: 'Duplicate' }, () => {}), { code: 'INVALID_ARGUMENT' })
  for (const options of [[], [null], [{ value: 'bad', label: '' }]] as unknown as { value: string; label: string }[][])
    assert.throws(() => view.addChoice({ id: 'invalid', label: 'Invalid', value: 'bad', options }, () => {}), {
      code: 'INVALID_ARGUMENT',
    })
  control.close()
  assert.throws(() => control.setValue('one'), { code: 'CLOSED' })
  await session.close()
})

test('appearance and used lights return to the host even when another app resource fails to close', async () => {
  const { AppSession } = await setup()
  const f = controlsFixture()
  const events: string[] = []
  f.ports.lighting = {
    names: ['eyes'],
    color() {
      throw new Error('output failed')
    },
    blink: (name, _color, { periodMs }) => {
      events.push(`blink:${name}:${periodMs}`)
    },
    rainbow: (name) => {
      events.push(`rainbow:${name}`)
    },
    off: (name) => {
      events.push(`off:${name}`)
    },
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  const lights = (session.context as AppContext & { lighting: AppLighting }).lighting
  const view = session.context.ui as AppUI
  view.setFaceStyle('dog')
  view.setEmoticon('heart')
  lights.rainbow('eyes')
  lights.blink('eyes', { r: 0, g: 24, b: 0 }, { periodMs: 250 })
  for (const periodMs of [0, -1, 99, Number.NaN, Number.POSITIVE_INFINITY, 86_400_001])
    assert.throws(() => lights.blink('eyes', { r: 0, g: 24, b: 0 }, { periodMs }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => lights.rainbow('missing'), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => lights.color('eyes', { r: 0, g: 0, b: 0 }), { code: 'IO' })
  f.ports.audio.close = async () => {
    throw new Error('audio close failed')
  }
  await assert.rejects(session.close(), /audio close failed/)
  assert.deepEqual(events, ['rainbow:eyes', 'blink:eyes:250', 'off:eyes'])
  assert.equal(f.resets(), 1)
  assert.throws(() => view.setEmoticon('heart'), { code: 'CLOSED' })
  assert.throws(() => lights.off('eyes'), { code: 'CLOSED' })
})

test('board diagnostics share SDK ownership, retain LED modes, report missing hardware and cancel on close', async () => {
  const { AppSession } = await setup()
  const { default: diagnostics } = await import('../../mods/examples/board_diagnostics/mod.js')
  const originalTrace = globalThis.trace
  const logs: string[] = []
  globalThis.trace = (...values: unknown[]) => {
    logs.push(values.join(''))
  }
  try {
    for (const mode of ['success', 'failedServo', 'missing', 'cancel'] as const) {
      logs.length = 0
      const f = controlsFixture()
      const buttons = new Map<string, () => void>()
      const events: string[] = []
      f.ports.input.subscribePress = (handler, name = 'primary') => {
        buttons.set(name, handler)
        return () => {
          buttons.delete(name)
        }
      }
      f.ports.lighting = {
        names: mode === 'missing' ? [] : ['head', 'a'],
        color: (name, { r, g, b }) => {
          events.push(`color:${name}:${r},${g},${b}`)
        },
        blink: (name, _color, { periodMs }) => {
          events.push(`blink:${name}:${periodMs}`)
        },
        rainbow: (name) => {
          events.push(`rainbow:${name}`)
        },
        off: (name) => {
          events.push(`off:${name}`)
        },
      }
      const poses: unknown[] = []
      f.ports.motion = {
        ...f.ports.motion,
        info:
          mode === 'missing'
            ? { availability: 'unavailable', reason: 'no servo' }
            : {
                availability: 'native',
                feedback: 'measured',
                canRelax: true,
                yawDeg: [-3, 3],
                pitchDeg: [-2, 2],
              },
        async move(target, options) {
          assert.ok(options.signal)
          poses.push(target)
          if (mode === 'failedServo') throw new StackchanError('IO', 'servo disconnected')
          return { completion: 'measured' }
        },
        async relax() {
          events.push('relax')
        },
        async close() {
          events.push('motion:close')
        },
      }
      const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
      await session.start(diagnostics)
      assert.equal(poses.length, 0, 'setup only schedules the automated check')
      await f.clock.advance(1000)
      const lateCheck = f.items.get('check')?.select
      assert.ok(lateCheck)
      if (mode === 'cancel') {
        await session.close()
        const closedEvents = events.length
        await f.clock.advance(20_000)
        lateCheck()
        await flush()
        assert.equal(events.length, closedEvents, 'closed diagnostics never resume their sequence')
        assert.equal(poses.length, 1)
        assert.ok(!logs.some((line) => line.includes('] complete')))
      } else {
        if (mode !== 'missing') {
          lateCheck()
          buttons.get('primary')?.()
          await flush()
        }
        await f.clock.advance(20_000)
        assert.equal(logs.filter((line) => line.includes('] start')).length, 1, 'a running check is not reentered')
        if (mode === 'missing') {
          assert.deepEqual(events, [])
          assert.equal(poses.length, 0)
          assert.ok(logs.some((line) => line.includes('] error: servo:') && line.includes('LED:')))
        } else {
          assert.deepEqual(events, ['relax', 'color:head:24,0,0', 'blink:head:250', 'rainbow:head', 'off:head'])
          if (mode === 'failedServo') {
            assert.equal(poses.length, 1)
            assert.ok(logs.some((line) => line.includes('] error: servo:')))
          } else {
            assert.deepEqual(poses, [
              { yawDeg: 0, pitchDeg: 0 },
              { yawDeg: 3, pitchDeg: -2 },
              { yawDeg: 0, pitchDeg: 0 },
            ])
            assert.ok(logs.some((line) => line.includes('] complete')))
            for (const button of ['primary', 'secondary', 'tertiary']) {
              buttons.get(button)?.()
              await flush()
            }
            f.items.get('blink')?.select()
            await flush()
            assert.deepEqual(events.slice(-4), ['color:head:255,0,0', 'off:head', 'rainbow:head', 'blink:head:250'])
          }
        }
        if (mode !== 'success')
          assert.ok(!logs.some((line) => line.includes('] complete')), 'failure is never a hardware pass')
        await session.close()
      }
      assert.equal(f.clock.jobs.size, 0)
      assert.equal(f.items.size, 0)
      assert.equal(buttons.size, 0)
      assert.equal(session.resourceCount, 0)
      assert.equal(session.taskCount, 0)
      assert.deepEqual(f.errors, [])
    }
  } finally {
    globalThis.trace = originalTrace
  }
})

test('screen registration shares the app lifetime and provides only the owning SDK context to factories', async () => {
  const { AppSession } = await setup()
  const f = fixture()
  const registered: Parameters<NonNullable<AppPorts['registerScreen']>>[0][] = []
  const removed: string[] = []
  let received: ScreenContext | undefined
  f.ports.registerScreen = (definition) => {
    registered.push(definition)
    return () => {
      removed.push(definition.id)
    }
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  const app: PiuAppDefinition = {
    apiVersion: 2,
    screens: [
      {
        id: 'sample',
        title: 'Sample',
        create(context) {
          received = context
          return {} as never
        },
      },
    ],
    setup(context) {
      assert.equal(context, session.context)
    },
  }
  await session.start(app)
  assert.equal(registered.length, 1)
  const close = () => {}
  registered[0].create({ width: 320, height: 196, close })
  assert.equal(received?.app, session.context)
  assert.equal(received?.close, close)
  assert.equal(Object.isFrozen(received), true)
  await session.close()
  await session.close()
  assert.deepEqual(removed, ['sample'])
  assert.throws(() => registered[0].create({ width: 320, height: 196, close }), { code: 'CLOSED' })
})

test('screen registration failure rolls back prior registrations before rejecting startup', async () => {
  const { AppSession } = await setup()
  const f = fixture()
  const removed: string[] = []
  const failure = new Error('registration failed')
  f.ports.registerScreen = (definition) => {
    if (definition.id === 'second') throw failure
    return () => {
      removed.push(definition.id)
    }
  }
  let started = false
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  const app: PiuAppDefinition = {
    apiVersion: 2,
    screens: ['first', 'second'].map((id) => ({ id, title: id, create: () => ({}) as never })),
    setup() {
      started = true
    },
  }
  await assert.rejects(session.start(app), /registration failed/)
  assert.equal(started, false)
  assert.deepEqual(removed, ['first'])
  assert.equal(session.state, 'closed')
})

test('screen startup rejects unsupported, malformed and over-capacity requests without invoking setup', async () => {
  const { AppSession } = await setup()
  for (const [screens, code] of [
    [[], 'UNSUPPORTED'],
    [[{ id: 'bad', title: 'Bad' }], 'INVALID_ARGUMENT'],
    [Array.from({ length: 17 }), 'INVALID_ARGUMENT'],
  ] as const) {
    const f = fixture()
    if (screens.length) f.ports.registerScreen = () => () => {}
    let started = false
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await assert.rejects(
      session.start({
        apiVersion: 2,
        screens,
        setup() {
          started = true
        },
      } as PiuAppDefinition),
      { code },
    )
    assert.equal(started, false)
    assert.equal(session.state, 'closed')
  }
})

test('look-around uses bounded angles, stops on the next press, and leaves no timer after closing', async () => {
  const { AppSession } = await setup()
  const { default: app } = await import('../../mods/examples/look_around/mod.js')
  const f = fixture()
  const targets: Array<{ yawDeg: number; pitchDeg: number }> = []
  let stopped = 0
  f.ports.motion = {
    ...f.ports.motion,
    info: {
      availability: 'simulated',
      feedback: 'estimated',
      canRelax: false,
      yawDeg: [8, 12],
      pitchDeg: [-5, 5],
    },
  }
  f.ports.motion.lookAt = (target) => targets.push(target)
  f.ports.motion.lookAway = () => {
    stopped++
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(app)
  f.clock.tick()
  await flush()
  assert.equal(targets.length, 0, 'the app waits for the user to start')
  const press = [...f.presses][0]
  press()
  await flush()
  for (let i = 0; i < 20; i++) {
    f.clock.tick()
    await flush()
  }
  assert.ok(targets.length > 0)
  for (const target of targets) {
    assert.ok(target.yawDeg >= 8 && target.yawDeg <= 12)
    assert.ok(target.pitchDeg >= -5 && target.pitchDeg <= 5)
  }
  press()
  await flush()
  assert.equal(stopped, 1, 'pressing stop removes gaze immediately')
  const count = targets.length
  f.clock.tick()
  await flush()
  assert.equal(targets.length, count)
  await session.close()
  press()
  f.clock.tick()
  await flush()
  assert.equal(targets.length, count)
  assert.equal(f.presses.size, 0)
  assert.equal(f.clock.jobs.size, 0)
  assert.deepEqual(f.errors, [])
})

test('monologue sends natural language to speech and resource names to clips without overlapping presses', async () => {
  const { AppSession } = await setup()
  const { default: app } = await import('../../mods/examples/monologue/mod.js')
  const { speeches } = await import('../../mods/examples/monologue/speeches_monologue.js')
  for (const speech of [true, false]) {
    const f = fixture()
    const calls: Array<[string, string]> = []
    let finish!: () => void
    f.ports.capabilities.get = (id) =>
      id === 'audio.speech' && !speech
        ? { availability: 'unavailable', reason: 'clips only' }
        : { availability: 'native' }
    const play = (kind: string, text: string) => {
      calls.push([kind, text])
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    f.ports.audio.say = (text) => play('speech', text)
    f.ports.audio.playClip = (name) => play('clip', name)
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await session.start(app)
    const press = [...f.presses][0]
    press()
    press()
    await flush()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], speech ? 'speech' : 'clip')
    assert.ok((speech ? Object.values(speeches) : Object.keys(speeches)).includes(calls[0][1]))
    finish()
    await flush()
    press()
    await flush()
    assert.equal(calls.length, 2, 'another press works after playback finishes')
    finish()
    await flush()
    await session.close()
    press()
    await flush()
    assert.equal(calls.length, 2)
    assert.equal(f.presses.size, 0)
    assert.deepEqual(f.errors, [])
  }
})

test('SDK examples show a setup hint without installing unusable controls when their devices are unavailable', async () => {
  const { AppSession } = await setup()
  const apps = [
    (await import('../../mods/examples/look_around/mod.js')).default,
    (await import('../../mods/examples/monologue/mod.js')).default,
  ]
  for (const app of apps) {
    const f = fixture()
    const hints: string[] = []
    f.ports.capabilities.get = () => ({ availability: 'unavailable', reason: 'no device' })
    f.ports.ui.showBalloon = (text) => hints.push(text)
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await session.start(app)
    assert.equal(hints.length, 1)
    assert.ok(hints[0].length > 0)
    assert.equal(f.presses.size, 0)
    assert.equal(f.clock.jobs.size, 0)
    await session.close()
    assert.deepEqual(f.errors, [])
  }
})

test('setup completes while registrations stay alive; presses do not overlap', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let calls = 0
  const started = session.start(
    defineApp({
      setup(app) {
        app.input.onPress('primary', async (task) => {
          calls += 1
          await task.sleep(1)
        })
      },
    }),
  )
  assert.equal(started, session.start(defineApp({ setup() {} })))
  await started
  assert.equal(session.state, 'running')
  const press = [...f.presses][0]
  press()
  press()
  press()
  await flush()
  assert.equal(calls, 1)
  f.clock.tick()
  await flush()
  press()
  await flush()
  assert.equal(calls, 2)
  const closed = session.close()
  assert.equal(closed, session.close())
  await closed
  press()
  assert.equal(calls, 2)
  assert.equal(f.presses.size, 0)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(session.taskCount, 0)
  assert.deepEqual(f.errors, [])
})

test('setup failure rolls back timers and inputs; errors reach the caller', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await assert.rejects(
    session.start(
      defineApp({
        setup(app) {
          app.time.every(10, () => {})
          app.input.onPress('primary', () => {})
          throw new Error('setup failed')
        },
      }),
    ),
    /setup failed/,
  )
  assert.equal(session.state, 'closed')
  assert.equal(session.resourceCount, 0)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.presses.size, 0)
})

test('app close cancels only its own queued and active device operations', async () => {
  const { AppSession, OperationQueue, defineApp } = await setup()
  const f = fixture()
  const queue = new OperationQueue({ clock: f.clock })
  const starts: string[] = []
  let cancelled = 0
  let finish: () => void
  f.ports.audio.say = (text, options) =>
    queue.run(
      () => {
        starts.push(text)
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      () => {
        cancelled += 1
      },
      options?.signal,
    )
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(defineApp({ setup() {} }))
  const active = session.context.audio.say('first')
  const pending = session.context.audio.say('second')
  await flush()
  const failures = Promise.all([
    assert.rejects(active, { code: 'CLOSED' }),
    assert.rejects(pending, { code: 'CLOSED' }),
  ])
  const closed = session.close()
  await assert.rejects(session.context.audio.say('after close'), { code: 'CLOSED' })
  await closed
  await failures
  finish()
  await flush()
  assert.equal(cancelled, 1)
  assert.deepEqual(starts, ['first'])
  assert.equal(queue.size, 0)
  assert.equal(queue.closed, false)
  assert.equal(await queue.run(() => 'another app'), 'another app')
  assert.equal(f.clock.jobs.size, 0)
})

test('app close waits for audio release after cooperative tasks have already cancelled', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  f.ports.audio.close = () => released
  f.ports.audio.say = (_text, options) =>
    new Promise((_, reject) => {
      options?.signal?.subscribe((reason) => reject(reason))
    })
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(defineApp({ setup() {} }))
  const speaking = assert.rejects(session.context.audio.say('hello'), { code: 'CLOSED' })
  await flush()
  let closed = false
  const closing = session.close().then(() => {
    closed = true
  })
  await speaking
  await flush()
  assert.equal(closed, false)
  assert.equal(session.state, 'closing')
  release()
  await closing
  assert.equal(session.state, 'closed')
})

test('late setup completion disposes resources without reopening a closed app', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let finish: (dispose: () => void) => void
  let disposed = 0
  const started = session.start(
    defineApp({
      setup: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    }),
  )
  const failed = assert.rejects(started, { code: 'CLOSED' })
  await flush()
  await session.close()
  await failed
  finish(() => {
    disposed += 1
  })
  await flush()
  assert.equal(disposed, 1)
  assert.equal(session.state, 'closed')
})

test('late asynchronous setup disposers finish once and report failures over 100 replacements', async () => {
  const { AppSession, defineApp } = await setup()
  for (let cycle = 0; cycle < 100; cycle++) {
    const f = fixture()
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    let finish!: (dispose: () => Promise<void>) => void
    let complete!: () => void
    let disposed = 0
    const failure = new Error('late cleanup failed')
    const started = session.start(
      defineApp({
        setup: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      }),
    )
    const stopped = assert.rejects(started, { code: 'CLOSED' })
    await flush()
    await session.close()
    await stopped
    finish(async () => {
      disposed++
      await new Promise<void>((resolve) => {
        complete = resolve
      })
      if (cycle % 2) throw failure
    })
    await flush()
    assert.equal(disposed, 1)
    assert.deepEqual(f.errors, [])
    complete()
    await flush()
    assert.deepEqual(f.errors, cycle % 2 ? [failure] : [])
    await session.close()
    assert.equal(session.state, 'closed')
    assert.equal(session.taskCount, 0)
    assert.equal(session.resourceCount, 0)
    assert.equal(disposed, 1)
  }
})

test('100 app replacements return tasks, subscriptions and timers to baseline', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    let app: AppContext
    await session.start(
      defineApp({
        setup(context) {
          app = context
          context.time.every(1, async (task) => {
            await task.sleep(1)
          })
          context.input.onPress('primary', () => {})
        },
      }),
    )
    f.clock.tick()
    await flush()
    await session.close()
    await assert.rejects(session.start(defineApp({ setup() {} })), { code: 'CLOSED' })
    await assert.rejects(app.time.sleep(1), { code: 'CLOSED' })
    assert.throws(() => app.face.setEmotion('happy'), { code: 'CLOSED' })
    assert.equal(f.clock.jobs.size, 0)
    assert.equal(f.presses.size, 0)
    assert.equal(session.taskCount, 0)
    assert.equal(session.resourceCount, 0)
  }
  assert.deepEqual(f.errors, [])
})

test('one-shot handler failure is reported once and releases its timer', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        app.time.after(1, () => {
          throw new Error('handler failed')
        })
      },
    }),
  )
  f.clock.tick()
  await flush()
  assert.equal(f.errors.length, 1)
  assert.match(String(f.errors[0]), /handler failed/)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(session.resourceCount, 0)
  await session.close()
})

test('app registration limits fail before acquiring another input subscription', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(defineApp({ setup() {} }))
  for (let i = 0; i < 64; i += 1) session.context.input.onPress('primary', () => {})
  assert.throws(() => session.context.input.onPress('primary', () => {}), { code: 'BUSY' })
  assert.equal(f.presses.size, 64)
  await session.close()
  assert.equal(f.presses.size, 0)
})

test('closing before task dispatch prevents handlers and devices from starting', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  let starts = 0
  f.ports.audio.say = async () => {
    starts += 1
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        app.input.onPress('primary', () => {
          starts += 1
        })
      },
    }),
  )
  const pending = session.context.audio.say('queued')
  for (const press of f.presses) press()
  const failed = assert.rejects(pending, { code: 'CLOSED' })
  await session.close()
  await failed
  assert.equal(starts, 0)
  assert.deepEqual(f.errors, [])
})

test('app camera combines cancellation and owns image UI and capture service on close', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const events: string[] = []
  let context: AppContext
  f.ports.camera = {
    info: { availability: 'native', formats: ['rgb565le'] },
    capture(options) {
      return new Promise((_resolve, reject) => {
        options.signal.subscribe((reason) => {
          events.push('cancel')
          reject(reason)
        })
      })
    },
    async close() {
      events.push('camera close')
    },
  }
  f.ports.ui.showImage = () => {
    events.push('image')
  }
  f.ports.ui.hideImage = () => {
    events.push('hide image')
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        context = app
      },
    }),
  )
  context.ui.showImage({ width: 1, height: 1, format: 'rgb565le', source: 'native', data: new ArrayBuffer(2) })
  const pending = context.camera.capture()
  const failed = assert.rejects(pending, { code: 'CLOSED' })
  await flush()
  await session.close()
  await failed
  assert.deepEqual(events, ['image', 'cancel', 'camera close', 'hide image'])
  assert.throws(
    () => context.ui.showImage({ width: 1, height: 1, format: 'rgb565le', source: 'native', data: new ArrayBuffer(2) }),
    { code: 'CLOSED' },
  )
  assert.equal(f.clock.jobs.size, 0)
})

test('connection close cancels its operations and removes subscriptions before releasing the device', async () => {
  const { AppSession, AppConnection, defineApp } = await setup()
  const f = fixture(),
    events: string[] = []
  let scope!: AppServiceScope
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const connection = new AppConnection(scope)
  connection.own(() => {
    events.push('device')
  })
  connection.own(() => {
    events.push('subscription')
  })
  const work = connection.run((task) => {
    task.signal.subscribe(() => events.push('cancel'))
    return task.sleep(1000)
  })
  const rejected = assert.rejects(work, { code: 'CLOSED' })
  await flush()
  await connection.close()
  await rejected
  assert.deepEqual(events, ['cancel', 'subscription', 'device'])
  assert.equal(app.resourceCount, 0)
  assert.equal(app.taskCount, 0)
  assert.equal(f.clock.jobs.size, 0)
  await app.close()
  assert.equal(events.length, 3)
})

test('late connection acquisition releases the device after the app has closed', async () => {
  const { AppSession, AppConnection, defineApp } = await setup()
  const f = fixture()
  let scope!: AppServiceScope,
    released = 0
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const connection = new AppConnection(scope)
  await app.close()
  assert.throws(
    () =>
      connection.own(() => {
        released++
      }),
    { code: 'CLOSED' },
  )
  await flush()
  assert.equal(released, 1)
  assert.equal(app.resourceCount, 0)
})

test('connection failures retain cleanup and do not deliver events after explicit close', async () => {
  const { AppSession, AppConnection, defineApp } = await setup()
  const f = fixture()
  let scope!: AppServiceScope,
    delivered = 0,
    released = 0
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const connection = new AppConnection(scope)
  connection.own(() => {
    released++
  })
  connection.own(() => {
    throw new Error('release failed')
  })
  const event = connection.event(() => {
    delivered++
  })
  event()
  const closing = connection.close()
  event()
  await assert.rejects(closing, /release failed/)
  assert.equal(delivered, 1)
  assert.equal(released, 1)
  assert.equal(app.resourceCount, 0)
  await app.close()
})

test('asynchronous connection observers report errors after close without keeping subscriptions alive', async () => {
  const { AppSession, AppConnection, defineApp } = await setup()
  for (const subscription of [false, true]) {
    const f = fixture()
    let scope!: AppServiceScope
    f.ports.extensions = (owner) => {
      scope = owner
      return {}
    }
    const app = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await app.start(defineApp({ setup() {} }))
    const connection = new AppConnection(scope)
    let resume!: () => void,
      emit!: () => void,
      delivered = 0,
      removed = 0
    const handler = async () => {
      delivered++
      await new Promise<void>((resolve) => {
        resume = resolve
      })
      throw new Error('observer failed asynchronously')
    }
    if (subscription)
      connection.listen((callback) => {
        emit = callback
        return () => {
          removed++
        }
      }, handler)
    else emit = connection.event(handler)
    emit()
    assert.equal(delivered, 1, 'event delivery stays synchronous until the first await')
    await connection.close()
    emit()
    resume()
    await flush()
    assert.equal(delivered, 1)
    assert.equal(removed, subscription ? 1 : 0)
    assert.equal(f.errors.length, 1)
    assert.equal((f.errors[0] as StackchanError).code, 'IO')
    assert.equal((f.errors[0] as Error).message, 'observer failed asynchronously')
    assert.equal(app.resourceCount, 0)
    await app.close()
  }
})

test('periodic app work reports a transient error and resumes on the next interval', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  let attempts = 0
  const app = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await app.start(
    defineApp({
      setup(context) {
        context.time.every(100, () => {
          if (++attempts === 1) throw new Error('temporarily offline')
        })
      },
    }),
  )
  await f.clock.advance(250)
  assert.equal(attempts, 2)
  assert.equal(f.errors.length, 1)
  await app.close()
  assert.equal(f.clock.jobs.size, 0)
})

const cloudSettings: AppSettings = {
  get: () => 'test-private-token' as never,
  describe: () => {
    throw new Error('unused')
  },
  set: () => {
    throw new Error('unused')
  },
}
const cloudAudio = { reserveStream: () => () => {}, failStream() {} }

test('SDK dialogue retains its response ID and awaits a tool before the follow-up request', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppConversation } = await import('./app-conversation.js')
  const f = fixture(),
    bodies: Record<string, unknown>[] = [],
    order: string[] = []
  let scope!: AppServiceScope
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const service = createAppConversation(scope, cloudSettings, cloudAudio, undefined, async (request) => {
    bodies.push(JSON.parse(request.body as string))
    order.push('request')
    return {
      status: 200,
      body: JSON.stringify(
        bodies.length === 1
          ? {
              id: 'response-1',
              output: [{ type: 'function_call', call_id: 'call-1', name: 'greet', arguments: '{}' }],
            }
          : { id: 'response-2', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }] },
      ),
    }
  })
  const dialogue = service.dialogue({
    tools: [
      {
        name: 'greet',
        description: '',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          order.push('tool')
          return 'done'
        },
      },
    ],
  })
  assert.equal(await dialogue.ask('greet me'), 'hello')
  assert.deepEqual(order, ['request', 'tool', 'request'])
  assert.equal(bodies[1].previous_response_id, 'response-1')
  assert.deepEqual(bodies[1].input, [{ type: 'function_call_output', call_id: 'call-1', output: 'done' }])
  await app.close()
})

test('failed or cancelled dialogue turns keep the last successful history checkpoint', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppConversation } = await import('./app-conversation.js')
  const { CancellationSource } = await import('./cancellation.js')
  for (const failure of ['http', 'limit', 'answer', 'cancel']) {
    const f = fixture()
    let scope!: AppServiceScope
    f.ports.extensions = (owner) => {
      scope = owner
      return {}
    }
    const app = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    await app.start(defineApp({ setup() {} }))
    const source = new CancellationSource()
    const bodies: Array<{ previous_response_id?: string }> = []
    let mode = 'success',
      round = 0
    const service = createAppConversation(scope, cloudSettings, cloudAudio, undefined, async (request) => {
      bodies.push(JSON.parse(request.body as string))
      if (mode === 'http' && round++ > 0) return { status: 503, body: '{}' }
      const text = mode === 'answer' ? 'a'.repeat(4097) : 'hello'
      return {
        status: 200,
        body: JSON.stringify({
          id: mode === 'success' ? 'committed' : 'tentative',
          output:
            mode === 'success' || mode === 'answer'
              ? [{ type: 'message', content: [{ type: 'output_text', text }] }]
              : [{ type: 'function_call', call_id: 'call', name: 'greet', arguments: '{}' }],
        }),
      }
    })
    const dialogue = service.dialogue({
      tools: [
        {
          name: 'greet',
          description: '',
          inputSchema: { type: 'object', properties: {}, required: [] },
          async execute() {
            if (mode === 'cancel') source.cancel()
            return 'done'
          },
        },
      ],
    })
    assert.equal(await dialogue.ask('first'), 'hello')
    mode = failure
    await assert.rejects(dialogue.ask('fails midway', { signal: source.signal }), {
      code: failure === 'cancel' ? 'CANCELLED' : 'IO',
    })
    await flush()
    mode = 'success'
    assert.equal(await dialogue.ask('retry'), 'hello')
    assert.equal(bodies.at(-1)?.previous_response_id, 'committed', failure)
    await app.close()
    assert.equal(app.taskCount, 0)
    assert.equal(app.resourceCount, 0)
    assert.deepEqual(f.errors, [])
  }
})

test('closing during a cloud request cancels the task and ignores a late tool call', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppConversation } = await import('./app-conversation.js')
  const f = fixture()
  let scope!: AppServiceScope,
    finish!: (value: { status: number; body: string }) => void,
    cancelled = 0,
    tools = 0
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const service = createAppConversation(scope, cloudSettings, cloudAudio, undefined, (_request, signal) => {
    assert.ok(signal)
    signal.subscribe(() => {
      cancelled++
    })
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const dialogue = service.dialogue({
    tools: [
      {
        name: 'greet',
        description: '',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: () => {
          tools++
          return 'done'
        },
      },
    ],
  })
  const pending = dialogue.ask('greet me'),
    rejected = assert.rejects(pending, { code: 'CLOSED' })
  await flush()
  await app.close()
  await rejected
  finish({
    status: 200,
    body: JSON.stringify({
      id: 'late',
      output: [{ type: 'function_call', call_id: 'late', name: 'greet', arguments: '{}' }],
    }),
  })
  await flush()
  assert.equal(cancelled, 1)
  assert.equal(tools, 0)
  assert.equal(app.resourceCount, 0)
})

test('SDK transcription retains the original recording as a separate multipart segment', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppConversation } = await import('./app-conversation.js')
  const f = fixture(),
    original = Uint8Array.of(1, 2, 3).buffer
  let scope!: AppServiceScope
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const bufferConstructor = ArrayBuffer as typeof ArrayBuffer & { fromString?: (text: string) => ArrayBuffer }
  const previous = bufferConstructor.fromString
  bufferConstructor.fromString = (text) => new TextEncoder().encode(text).buffer
  try {
    const service = createAppConversation(scope, cloudSettings, cloudAudio, undefined, async (request) => {
      assert.ok(Array.isArray(request.body))
      const parts = request.body as readonly ArrayBuffer[]
      assert.equal(parts[1], original, 'upload must not copy the complete recording into another buffer')
      assert.match(new TextDecoder().decode(parts[0]), /filename="recording.ogg"/)
      assert.match(request.headers['Content-Type'], /^multipart\/form-data; boundary=/)
      return { status: 200, body: '{"text":"hello"}' }
    })
    assert.equal(
      await service.transcribe({ data: original, mimeType: 'audio/ogg', filename: 'recording.ogg' }),
      'hello',
    )
  } finally {
    bufferConstructor.fromString = previous
    await app.close()
  }
})

test('USB request acceptance does not commit the menu toggle before observed conversation state', async () => {
  const { AppSession } = await setup()
  const { default: definition } = await import('../../mods/examples/codex_voice/mod.js')
  const f = controlsFixture()
  let state: 'standby' | 'listening' = 'standby'
  let notify!: (state: 'standby' | 'listening') => void
  let starts = 0,
    stops = 0
  f.ports.capabilities.get = () => ({ availability: 'unavailable', reason: 'No head touch in this test' })
  f.ports.extensions = () => ({
    conversation: {
      remote: () => ({
        get state() {
          return state
        },
        transport: 'ready',
        requestStart() {
          starts++
          return 'accepted-start'
        },
        requestStop() {
          stops++
          return 'accepted-stop'
        },
        onState(handler) {
          notify = handler
          return () => {}
        },
        onTransport() {
          return () => {}
        },
        async close() {},
      }),
      async connectTools() {
        throw new Error('unused')
      },
      dialogue() {
        throw Error('not used')
      },
      async transcribe() {
        throw Error('not used')
      },
      async realtime() {
        throw Error('not used')
      },
    },
  })
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(definition)
  const toggle = f.items.get('remote')
  assert.ok(toggle)
  toggle.select()
  await flush()
  assert.equal(starts, 1)
  assert.equal(toggle.value, false, 'accepted start stays off while in standby')
  state = 'listening'
  notify(state)
  assert.equal(toggle.value, true)
  toggle.select()
  await flush()
  assert.equal(stops, 1)
  assert.equal(toggle.value, true, 'accepted stop stays on until standby is observed')
  state = 'standby'
  notify(state)
  assert.equal(toggle.value, false)
  await session.close()
  assert.deepEqual(f.errors, [])
})

test('physical swipes and synthesized petting reach unfiltered handlers in order without overlap', async () => {
  const { AppSession, defineApp } = await setup()
  const { StackchanRuntimeInput } = await import('./runtime-input.js')
  const { input } = await import('../../sdk/extensions/input.js')
  type TouchPanel = import('../modules/input/touch-panel.js').default
  for (const mode of ['sync', 'async', 'throw']) {
    for (const first of ['forwardSwipe', 'backwardSwipe'] as const) {
      const f = fixture()
      const listeners = new Set<Parameters<TouchPanel['subscribe']>[0]>()
      const runtime = new StackchanRuntimeInput({
        touchPanel: {
          start() {},
          subscribe(handler: Parameters<TouchPanel['subscribe']>[0]) {
            listeners.add(handler)
            return () => listeners.delete(handler)
          },
          close() {
            listeners.clear()
          },
        } as unknown as TouchPanel,
      })
      f.ports.input.subscribeHeadTouch = (handler) => runtime.subscribeHeadTouch(handler)
      const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
      const delivered: string[] = [],
        filtered: string[] = []
      let active = 0,
        maximum = 0
      await session.start(
        defineApp({
          setup(app) {
            input(app).onHeadTouch((event, task) => {
              delivered.push(event.gesture)
              maximum = Math.max(maximum, ++active)
              if (mode === 'async')
                return task.sleep(5).finally(() => {
                  active--
                })
              active--
              if (mode === 'throw' && delivered.length === 1) throw new Error('touch observer failed')
            })
            input(app).onHeadTouch(
              (event) => {
                filtered.push(event.gesture)
              },
              { gesture: 'petting' },
            )
          },
        }),
      )
      const second = first === 'forwardSwipe' ? 'backwardSwipe' : 'forwardSwipe'
      for (const [gesture, ticks] of [
        [first, 100],
        [second, 500],
      ] as const)
        for (const receive of [...listeners])
          receive({ kind: 'touch-panel', gesture, ticks, position: 0.5, intensity: 1 })
      await f.clock.advance(100)
      assert.deepEqual(delivered, [first, second, 'petting'])
      assert.deepEqual(filtered, ['petting'])
      assert.equal(maximum, 1, 'one subscription never overlaps its own handler')
      assert.equal(f.errors.length, mode === 'throw' ? 1 : 0)
      if (mode === 'throw') assert.match(String(f.errors[0]), /touch observer failed/)
      await session.close()
      assert.equal(listeners.size, 0)
      assert.equal(session.taskCount, 0)
      await runtime.close()
    }
  }
})

test('head touch queues are bounded and discard pending callbacks on unsubscribe or app close', async () => {
  const { AppSession, defineApp } = await setup()
  const { input } = await import('../../sdk/extensions/input.js')
  for (const end of ['drain', 'unsubscribe', 'close']) {
    const f = fixture()
    let receive!: (event: import('../../sdk/extensions/input.js').HeadTouchEvent) => void
    let removed = 0
    f.ports.input.subscribeHeadTouch = (handler) => {
      receive = handler
      return () => {
        removed++
      }
    }
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    const delivered: number[] = []
    let finished = 0,
      off!: () => void
    await session.start(
      defineApp({
        setup(app) {
          off = input(app).onHeadTouch(async (event, task) => {
            assert.ok(event.tapDurationMs !== undefined)
            delivered.push(event.tapDurationMs)
            await task.sleep(10)
            finished++
          })
        },
      }),
    )
    for (let i = 0; i <= 12; i++) receive({ gesture: 'release', tapDurationMs: i })
    await flush()
    assert.deepEqual(delivered, [0])
    if (end === 'unsubscribe') off()
    if (end === 'close') await session.close()
    await f.clock.advance(200)
    if (end === 'drain') {
      assert.deepEqual(
        delivered,
        [0, 5, 6, 7, 8, 9, 10, 11, 12],
        'overflow retains the eight most recent pending gestures',
      )
      assert.equal(finished, delivered.length)
      off()
    } else {
      assert.deepEqual(delivered, [0], 'queued callbacks never start after cancellation')
      assert.equal(finished, 0)
    }
    receive({ gesture: 'petting' })
    await f.clock.advance(200)
    assert.equal(delivered.length, end === 'drain' ? 9 : 1)
    await session.close()
    assert.equal(removed, 1)
    assert.equal(session.resourceCount, 0)
    assert.equal(session.taskCount, 0)
    assert.deepEqual(f.errors, [])
  }
})

test('release and filtered petting handlers share AppSession cancellation and disposal over 100 lifetimes', async () => {
  const { AppSession } = await setup()
  const { input } = await import('../../sdk/extensions/input.js')
  for (let cycle = 0; cycle < 100; cycle++) {
    const f = fixture()
    let release: (() => void) | undefined
    let head: ((event: import('../../sdk/extensions/input.js').HeadTouchEvent) => void) | undefined
    f.ports.input.subscribeRelease = (handler) => {
      release = handler
      return () => {
        release = undefined
      }
    }
    f.ports.input.subscribeHeadTouch = (handler) => {
      head = handler
      return () => {
        head = undefined
      }
    }
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    let starts = 0,
      finishes = 0
    await session.start({
      apiVersion: 2,
      setup(app) {
        const inputs = input(app)
        inputs.onRelease('primary', async (task) => {
          starts++
          await task.sleep(1000)
          finishes++
        })
        inputs.onHeadTouch(
          async (_event, task) => {
            starts++
            await task.sleep(1000)
            finishes++
          },
          { gesture: 'petting' },
        )
      },
    })
    assert.ok(release)
    assert.ok(head)
    const lateRelease = release,
      lateHead = head
    release()
    release()
    head({ gesture: 'backwardSwipe' })
    head({ gesture: 'petting' })
    await flush()
    assert.equal(starts, 2, 'filtering precedes the one-in-flight handler check')
    await session.close()
    lateRelease()
    lateHead({ gesture: 'petting' })
    await f.clock.advance(2000)
    assert.equal(finishes, 0)
    assert.equal(starts, 2)
    assert.equal(release, undefined)
    assert.equal(head, undefined)
    assert.equal(session.resourceCount, 0)
    assert.equal(session.taskCount, 0)
    assert.equal(f.clock.jobs.size, 0)
    assert.deepEqual(f.errors, [])
  }
})

test('connection subscriptions release once and suppress callbacks after manual unsubscribe', async () => {
  const { AppSession, AppConnection, defineApp } = await setup()
  const f = fixture()
  let scope!: AppServiceScope,
    receive!: (value: number) => void,
    releases = 0
  const values: number[] = []
  f.ports.extensions = (owner) => {
    scope = owner
    return {}
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const connection = new AppConnection(scope)
  const off = connection.listen(
    (handler: (value: number) => void) => {
      receive = handler
      return () => {
        releases++
      }
    },
    (value) => values.push(value),
  )
  receive(1)
  off()
  receive(2)
  off()
  await connection.close()
  receive(3)
  await app.close()
  assert.deepEqual(values, [1])
  assert.equal(releases, 1)
  assert.equal(app.resourceCount, 0)
})

test('SDK networking preserves host error codes instead of converting every failure to IO', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppNetwork } = await import('./app-network.js')
  const { NetworkConnectionState } = await import('../modules/connectivity/network-state.js')
  for (const code of ['TIMEOUT', 'BUSY', 'UNSUPPORTED', 'INVALID_ARGUMENT'] as const) {
    const f = fixture()
    let service!: ReturnType<typeof createAppNetwork>
    f.ports.extensions = (scope) => {
      service = createAppNetwork(scope, {
        network: {
          availability: 'native',
          state: NetworkConnectionState.FAILED,
          ready: Promise.resolve({ status: 'failed', reason: 'network test', code }),
        },
        localPeer: {
          id: '001122334455',
          open: async () => {
            throw new StackchanError(code, 'peer test')
          },
        },
      })
      return { network: service }
    }
    const app = new AppSession(f.ports, f.clock, () => {})
    await app.start(defineApp({ setup() {} }))
    await assert.rejects(service.ready(), { code })
    await assert.rejects(service.openPeer({ service: 'test' }), { code })
    await app.close()
    assert.equal(app.resourceCount, 0)
  }
})

test('app shutdown reaches a local peer open and releases its radio before late completion', async () => {
  const { AppSession, defineApp } = await setup()
  const { createAppNetwork } = await import('./app-network.js')
  const f = fixture()
  let service!: ReturnType<typeof createAppNetwork>,
    finish!: () => void,
    closes = 0,
    acquired = false
  f.ports.extensions = (scope) => {
    service = createAppNetwork(scope, {
      localPeer: {
        id: '001122334455',
        open: (_options, signal) => {
          acquired = true
          assert.ok(signal)
          return new Promise((resolve, reject) => {
            const unsubscribe = signal.subscribe((error) => {
              closes++
              reject(error)
            })
            finish = () => {
              unsubscribe()
              resolve({
                discover: async () => [],
                send: async () => ({ messageId: '', peerId: '', attempts: 1 }),
                broadcast: async () => ({ messageId: '' }),
                subscribe: () => () => {},
                close: () => {
                  closes++
                },
              })
            }
          })
        },
      },
    })
    return { network: service }
  }
  const app = new AppSession(f.ports, f.clock, () => {})
  await app.start(defineApp({ setup() {} }))
  const rejected = assert.rejects(service.openPeer({ service: 'test' }), { code: 'CLOSED' })
  await flush()
  assert.equal(acquired, true)
  await app.close()
  await rejected
  assert.equal(closes, 1)
  finish()
  await flush()
  assert.equal(closes, 1)
  assert.equal(app.resourceCount, 0)
})
