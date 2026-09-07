import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AppContext } from '../../sdk/app.js'
import { StackchanError } from '../../sdk/errors.js'
import type { AppLighting } from '../../sdk/extensions/lighting.js'
import type { PiuAppDefinition, ScreenContext } from '../../sdk/extensions/piu.js'
import type { AppUI } from '../../sdk/extensions/ui.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { AppPorts } from './app-session.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackageSubpath(resolve(hostRoot, '..'), 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackage(resolve(hostRoot, '..'), 'stackchan', resolve(hostRoot, '../sdk/app.js'))
  for (const name of ['input', 'ui', 'lighting'])
    for (const directory of [hostRoot, resolve(hostRoot, '..')])
      writeAliasPackageSubpath(
        directory,
        'stackchan',
        `extensions/${name}`,
        resolve(hostRoot, `../sdk/extensions/${name}.js`),
      )
  for (const name of ['owned-resources', 'cancellation', 'task-scope']) {
    writeAliasPackage(hostRoot, name, resolve(hostRoot, `app/${name}.js`))
  }
  const { AppSession } = await import('./app-session.js')
  const { OperationQueue } = await import('./operation-queue.js')
  const { defineApp } = await import('../../sdk/app.js')
  return { AppSession, OperationQueue, defineApp }
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

test('handler failure is reported once and does not leave a recurring timer alive', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        app.time.every(1, () => {
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
