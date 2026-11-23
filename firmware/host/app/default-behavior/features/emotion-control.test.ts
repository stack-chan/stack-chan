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
  assert.equal(fixture.torques[fixture.torques.length - 1], false)

  FakeTimer.advance(6000)
  assert.deepEqual(fixture.emotions, [Emotion.HAPPY, Emotion.SAD])

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

test('emotion-control releases torque if scope closes while setTorque(true) is still in flight', async () => {
  installAliases()
  const { installEmotionControl } = (await import('./emotion-control.js')) as EmotionControlModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  let resolveTorqueEnable: (() => void) | undefined
  const torques: boolean[] = []
  const fixture = createEmotionFixture()
  const { scope, close } = createScope()
  installEmotionControl(
    {
      ...fixture.deps,
      setTorque(torque) {
        torques.push(torque)
        if (torque) {
          return new Promise<void>((resolve) => {
            resolveTorqueEnable = resolve
          })
        }
        return Promise.resolve()
      },
    },
    scope,
  )

  fixture.emitTouch('forwardSwipe', 100)
  fixture.emitTouch('backwardSwipe', 500)
  assert.deepEqual(torques, [true])

  await close()
  resolveTorqueEnable?.()
  await flushMicrotasks()

  assert.deepEqual(torques, [true, false])
  assert.deepEqual(fixture.poses, [])
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

test('camera-preview-feature clears preview timer on scope close so showFace is not called after close', async () => {
  installAliases()
  const { installCameraPreviewFeature } = (await import('./camera-preview-feature.js')) as CameraPreviewFeatureModule
  const { default: FakeTimer } = (await import('../../../modules/testing/fakes/timer.js')) as FakeTimerModule
  FakeTimer.reset()

  let showFaceCount = 0
  let stopCount = 0
  let frameClosed = false
  let triggerPreview: (() => Promise<void>) | undefined

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
      setMain() {},
      showFace() {
        showFaceCount += 1
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
  assert.equal(showFaceCount, 0)

  await close()
  FakeTimer.advance(6000)
  assert.equal(showFaceCount, 0)
})
