import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ModScope } from 'mod-kit'
import { writeAliasPackage } from '../../../modules/testing/node-alias-package.js'
import { Emotion } from '../../../modules/ui/state/face-state.js'
import { isOk } from '../../../modules/util/result.js'
import type {
  EmotionControlDeps,
  EmotionControlEmoticonKey,
  EmotionControlImu,
  EmotionControlTouchPanel,
} from './emotion-control.js'

type EmotionControlModule = typeof import('./emotion-control.js')
type HandGestureModule = typeof import('./hand-gesture.js')
type CameraPreviewFeatureModule = typeof import('./camera-preview-feature.js')
type FakeTimerModule = typeof import('../../../modules/testing/fakes/timer.js')

function installAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
  writeAliasPackage(hostRoot, 'mac-address', resolve(hostRoot, 'modules/util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(hostRoot, 'stackchan-result', resolve(hostRoot, 'modules/util/result.js'))
  writeAliasPackage(hostRoot, 'stackchan-util', resolve(hostRoot, 'modules/util/stackchan-util.js'))
  writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), {
    hasDefaultExport: true,
  })
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function createScope() {
  const cleanups: Array<() => void | Promise<void>> = []
  const scope: ModScope = {
    own(cleanup) {
      cleanups.unshift(cleanup)
    },
  }
  return {
    scope,
    async close() {
      const snapshot = cleanups.splice(0, cleanups.length)
      for (const cleanup of snapshot) {
        await cleanup()
      }
    },
  }
}

function createEmotionFixture() {
  const emotions: Emotion[] = []
  const effects: string[] = []
  const torques: boolean[] = []
  const poses: Array<{ rotation: { y: number; p: number; r: number }; durationSec?: number }> = []
  let imuStarted = false
  let touchUnsubscribed = false
  let drawerCallback: ((value?: string) => void) | undefined
  let touchListener: ((event: { readonly gesture: string; readonly ticks: number }) => void) | undefined

  const imu: EmotionControlImu = {
    start() {
      imuStarted = true
    },
  }

  const touchPanel: EmotionControlTouchPanel = {
    subscribe(listener) {
      touchListener = listener
      return () => {
        touchUnsubscribed = true
        touchListener = undefined
      }
    },
  }

  const deps: EmotionControlDeps<string> = {
    setEmotion(emotion) {
      emotions.push(emotion)
    },
    addEffect(effect) {
      effects.push(effect)
    },
    removeEffect(effect) {
      const index = effects.indexOf(effect)
      if (index >= 0) effects.splice(index, 1)
    },
    createEmoticon(key: EmotionControlEmoticonKey) {
      return `emoticon:${key}`
    },
    addDrawerButton(button) {
      assert.equal(button.key, 'cycleEmotion')
      drawerCallback = button.callback
    },
    getBodyPose() {
      return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { y: 0, p: 0, r: 0 },
      }
    },
    async setPose(pose, durationSec) {
      poses.push({ rotation: { ...pose.rotation }, durationSec })
    },
    async setTorque(torque) {
      torques.push(torque)
    },
    localize(key) {
      return key
    },
    imu,
    touchPanel,
    waitMs: async () => {},
    randomBetween: (min) => min,
    random: () => 0.75,
    log: () => {},
  }

  return {
    deps,
    emotions,
    effects,
    torques,
    poses,
    imu,
    get imuStarted() {
      return imuStarted
    },
    get touchUnsubscribed() {
      return touchUnsubscribed
    },
    selectEmotion(value?: string) {
      drawerCallback?.(value)
    },
    emitTouch(gesture: string, ticks: number) {
      touchListener?.({ gesture, ticks })
    },
  }
}

test('emotion-control switches emotions and emoticons via drawer and ignores invalid values', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  const installed = installEmotionControl(fixture.deps, scope)
  assert.equal(isOk(installed), true)
  assert.equal(fixture.imuStarted, true)

  fixture.selectEmotion(String(Emotion.HAPPY))
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY])
  assert.deepEqual(fixture.effects, ['emoticon:heart'])

  fixture.selectEmotion('not-a-valid-emotion')
  fixture.selectEmotion('')
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY])
  assert.deepEqual(fixture.effects, ['emoticon:heart'])

  fixture.selectEmotion(String(Emotion.NEUTRAL))
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.NEUTRAL])
  assert.deepEqual(fixture.effects, [])

  await close()
})

test('emotion-control reacts to IMU motion and restores the previous emotion after 5000ms', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(fixture.deps, scope)

  fixture.selectEmotion(String(Emotion.SLEEPY))
  fixture.imu.onEvent?.({ motion: 'shake' })

  assert.deepEqual(fixture.emotions, [Emotion.SLEEPY, Emotion.HOT])
  assert.deepEqual(fixture.effects, ['emoticon:sweat'])

  FakeTimer.advance(5000)
  assert.deepEqual(fixture.emotions, [Emotion.SLEEPY, Emotion.HOT, Emotion.SLEEPY])
  assert.deepEqual(fixture.effects, ['emoticon:sleepy'])

  await close()
})

test('emotion-control petting triggers HAPPY motion and manual selection cancels petting and releases torque', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(fixture.deps, scope)

  fixture.emitTouch('forwardSwipe', 1000)
  fixture.emitTouch('backwardSwipe', 1800)
  await flushMicrotasks()

  assert.deepEqual(fixture.emotions, [Emotion.HAPPY])
  assert.deepEqual(fixture.effects, ['emoticon:heart'])
  assert.equal(fixture.torques[0], true)
  assert.ok(fixture.poses.length >= 4)

  fixture.selectEmotion(String(Emotion.SAD))
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.SAD])
  assert.deepEqual(fixture.effects, ['emoticon:tear'])
  await flushMicrotasks()
  assert.equal(fixture.torques[fixture.torques.length - 1], false)

  FakeTimer.advance(6000)
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.SAD])

  await close()
})

test('emotion-control restores the previous pose and emotion after uninterrupted petting', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(fixture.deps, scope)

  fixture.selectEmotion(String(Emotion.SLEEPY))
  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()

  FakeTimer.advance(1000)
  await flushMicrotasks()
  assert.deepEqual(fixture.emotions, [Emotion.SLEEPY, Emotion.HAPPY])
  assert.deepEqual(fixture.torques, [true])
  assert.notDeepEqual(fixture.poses.at(-1)?.rotation, fixture.deps.getBodyPose().rotation)

  FakeTimer.advance(4000)
  await flushMicrotasks()
  assert.deepEqual(fixture.emotions, [Emotion.SLEEPY, Emotion.HAPPY, Emotion.SLEEPY])
  assert.deepEqual(fixture.poses.at(-1)?.rotation, fixture.deps.getBodyPose().rotation)
  assert.deepEqual(fixture.torques, [true, false])

  await close()
})

test('emotion-control scope cleanup clears timers, detaches sensors, removes active emoticon, and releases petting torque', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(fixture.deps, scope)

  fixture.imu.onEvent?.({ motion: 'shake' })
  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()

  assert.deepEqual(fixture.torques, [true])
  const emotionCountBeforeClose = fixture.emotions.length
  const poseCountBeforeClose = fixture.poses.length

  await close()

  assert.deepEqual(fixture.torques, [true, false])
  assert.equal(fixture.touchUnsubscribed, true)
  assert.equal(fixture.imu.onEvent, undefined)
  assert.deepEqual(fixture.effects, [])

  FakeTimer.advance(10000)
  await flushMicrotasks()
  assert.equal(fixture.emotions.length, emotionCountBeforeClose)
  assert.equal(fixture.poses.length, poseCountBeforeClose)
})

test('emotion-control scope close waits for pending torque enable and disable', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const enabling = Promise.withResolvers<void>()
  const disabling = Promise.withResolvers<void>()
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      setTorque(torque) {
        fixture.torques.push(torque)
        return torque ? enabling.promise : disabling.promise
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true])

  let closed = false
  const closing = close().then(() => {
    closed = true
  })
  await flushMicrotasks()
  assert.equal(fixture.touchUnsubscribed, true)
  assert.equal(closed, false)

  enabling.resolve()
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true, false])
  assert.deepEqual(fixture.poses, [])
  assert.equal(closed, false)

  disabling.resolve()
  await closing
  assert.equal(closed, true)
})

test('emotion-control scope close retries a failed torque disable', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      async setTorque(torque) {
        fixture.torques.push(torque)
        if (!torque && fixture.torques.length === 2) throw new Error('servo response lost')
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  fixture.selectEmotion(String(Emotion.SAD))
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true, false])

  await close()
  assert.deepEqual(fixture.torques, [true, false, false])
})

test('emotion-control scope close reports a failed final torque disable', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const earlyFailure = new Error('servo response lost')
  const finalFailure = new Error('servo disable timed out')
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      async setTorque(torque) {
        fixture.torques.push(torque)
        if (!torque) throw fixture.torques.length === 2 ? earlyFailure : finalFailure
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  fixture.selectEmotion(String(Emotion.SAD))
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true, false])

  await assert.rejects(close(), (error) => error === finalFailure)
  assert.deepEqual(fixture.torques, [true, false, false])
})

test('emotion-control restores a pose after normal expiry waits for the last petting pose', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const raised = Promise.withResolvers<void>()
  const restored = Promise.withResolvers<void>()
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      async setPose(pose, durationSec) {
        await fixture.deps.setPose(pose, durationSec)
        if (fixture.poses.length === 4) await raised.promise
        if (fixture.poses.length === 5) await restored.promise
      },
    },
    scope,
  )

  fixture.selectEmotion(String(Emotion.SLEEPY))
  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 4)

  FakeTimer.advance(5000)
  await flushMicrotasks()
  assert.deepEqual(fixture.emotions, [Emotion.SLEEPY, Emotion.HAPPY, Emotion.SLEEPY])
  assert.equal(fixture.poses.length, 4)
  assert.deepEqual(fixture.torques, [true])

  raised.resolve()
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 5)
  assert.deepEqual(fixture.poses.at(-1)?.rotation, fixture.deps.getBodyPose().rotation)
  assert.deepEqual(fixture.torques, [true])

  restored.resolve()
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true, false])
  await close()
})

test('emotion-control restores a pose before releasing torque when a pending petting pose fails after expiry', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const raised = Promise.withResolvers<void>()
  const restored = Promise.withResolvers<void>()
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      async setPose(pose, durationSec) {
        await fixture.deps.setPose(pose, durationSec)
        if (fixture.poses.length === 4) await raised.promise
        if (fixture.poses.length === 5) await restored.promise
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 4)
  FakeTimer.advance(5000)
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 4)

  raised.reject(new Error('servo command failed'))
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 5)
  assert.deepEqual(fixture.poses.at(-1)?.rotation, fixture.deps.getBodyPose().rotation)
  assert.deepEqual(fixture.torques, [true])

  restored.resolve()
  await flushMicrotasks()
  assert.deepEqual(fixture.torques, [true, false])
  await close()
})

test('manual emotion selection retires a pending petting enable before admitting a new motion', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const firstEnable = Promise.withResolvers<void>()
  const firstRelease = Promise.withResolvers<void>()
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      async setTorque(torque) {
        fixture.torques.push(torque)
        if (fixture.torques.length === 1) await firstEnable.promise
        else if (fixture.torques.length === 2) await firstRelease.promise
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  fixture.selectEmotion(String(Emotion.SAD))
  firstEnable.resolve()
  await flushMicrotasks()

  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.SAD])
  assert.deepEqual(fixture.poses, [])
  assert.deepEqual(fixture.torques, [true, false])

  fixture.emitTouch('forwardSwipe', 1000)
  fixture.emitTouch('backwardSwipe', 1500)
  await flushMicrotasks()
  assert.deepEqual(fixture.poses, [])
  assert.deepEqual(fixture.torques, [true, false])

  firstRelease.resolve()
  await flushMicrotasks()
  fixture.emitTouch('forwardSwipe', 2000)
  fixture.emitTouch('backwardSwipe', 2500)
  await flushMicrotasks()
  assert.ok(fixture.poses.length > 0)
  assert.deepEqual(fixture.torques, [true, false, true])

  await close()
})

test('manual emotion selection prevents later shake poses and a hold while a petting motion waits', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  const shakeWait = Promise.withResolvers<void>()
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl({ ...fixture.deps, waitMs: () => shakeWait.promise }, scope)

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  await flushMicrotasks()
  assert.equal(fixture.poses.length, 1)

  fixture.selectEmotion(String(Emotion.SAD))
  shakeWait.resolve()
  await flushMicrotasks()
  FakeTimer.advance(6000)

  assert.equal(fixture.poses.length, 1)
  assert.deepEqual(fixture.torques, [true, false])
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.SAD])

  await close()
})

test('hand-gesture updates animation on valid selection and resets to none on scope close', async () => {
  installAliases()
  const { installHandGesture } = (await import('./hand-gesture.js')) as HandGestureModule
  const animations: string[] = []
  let drawerClosed = 0
  let onSelect: ((value?: string) => void) | undefined

  const { scope, close } = createScope()
  const installed = installHandGesture(
    {
      setHandAnimation(animation) {
        animations.push(animation)
      },
      closeDrawer() {
        drawerClosed += 1
      },
      addDrawerButton(button) {
        assert.equal(button.key, 'handAnimation')
        assert.equal(button.label, '手')
        onSelect = button.callback
      },
    },
    scope,
  )
  assert.equal(isOk(installed), true)
  assert.deepEqual(animations, ['none'])

  onSelect?.('invalid')
  assert.deepEqual(animations, ['none'])
  assert.equal(drawerClosed, 0)

  onSelect?.('clap')
  assert.deepEqual(animations, ['none', 'clap'])
  assert.equal(drawerClosed, 1)

  await close()
  assert.deepEqual(animations, ['none', 'clap', 'none'])
})

test('camera-preview-feature clears the pending restore timer when its screen is replaced', async () => {
  installAliases()
  const { installCameraPreviewFeature } = (await import('./camera-preview-feature.js')) as CameraPreviewFeatureModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  let closeScreenCount = 0
  let stopCount = 0
  let frameClosed = false
  let triggerPreview: (() => Promise<void>) | undefined
  let onMainClosed: (() => void) | undefined

  const { scope, close } = createScope()
  const installed = installCameraPreviewFeature(
    {
      camera: {
        available: true,
        async start() {},
        async capture() {
          return {
            close() {
              frameClosed = true
            },
          }
        },
        stop() {
          stopCount += 1
        },
      },
      captureImageType: 'rgb565le',
      prepareFrame: () => ({ width: 200, height: 120, imageType: 'rgb565le' }),
      createDialog: (preview) => ({ preview }),
      setMain(_content, options) {
        onMainClosed = options?.onClose
        return () => {
          closeScreenCount += 1
          onMainClosed?.()
        }
      },
      closeDrawer() {},
      showBalloon() {},
      hideBalloon() {},
      hideBalloonLater() {},
      localize: (key) => key,
      addDrawerButton(button) {
        assert.equal(button.key, 'cameraPreview')
        triggerPreview = button.callback
      },
      log: () => {},
    },
    scope,
  )
  assert.equal(isOk(installed), true)

  const previewRun = triggerPreview?.()
  await flushMicrotasks()
  FakeTimer.advance(120)
  await previewRun

  assert.equal(frameClosed, true)
  assert.equal(stopCount, 1)
  assert.equal(closeScreenCount, 0)
  assert.equal(typeof onMainClosed, 'function')

  onMainClosed?.()
  FakeTimer.advance(6000)
  assert.equal(closeScreenCount, 0, 'replacing the preview screen cancels the pending restore timer')

  await close()
  FakeTimer.advance(6000)
  assert.equal(closeScreenCount, 0)
})
