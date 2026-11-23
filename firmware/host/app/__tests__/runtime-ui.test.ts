import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RobotUI } from 'capabilities'
import { Emotion, type FaceState } from '../../modules/ui/state/face-state.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

type RuntimeUIModule = typeof import('../runtime-ui.js')

function installAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(hostRoot, 'avatar-expression', resolve(hostRoot, 'modules/ui/state/avatar-expression.js'))
  writeAliasPackage(hostRoot, 'domain-values', resolve(hostRoot, 'modules/util/domain-values.js'))
  writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
  writeAliasPackageSubpath(
    hostRoot,
    'effects',
    'speech-balloon',
    resolve(hostRoot, 'app/__tests__/fakes/speech-balloon.js'),
  )
}

function createFakeUI() {
  const updates: Array<{ interval: number; emotion: Emotion; mouth: number; gazeX: number }> = []
  const ui: RobotUI = {
    miniApps: { register: () => () => {} },
    update(interval: number, faceState: FaceState) {
      updates.push({
        interval,
        emotion: faceState.emotion,
        mouth: faceState.mouth.open,
        gazeX: faceState.eyes.left.gazeX,
      })
    },
    addEffect() {},
    removeEffect() {},
    setFace() {},
    setHandAnimation() {},
    setMain() {},
    showFace() {},
    setDrawerButtons() {},
    addDrawerButton() {},
    removeDrawerButton() {},
    setDrawerButtonState() {},
    bindDrawerAction: () => true,
    unbindDrawerAction() {},
    openDrawer() {},
    closeDrawer() {},
    toggleDrawer() {},
  }
  return { ui, updates }
}

const defaultPose = {
  body: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
  eyes: {
    left: { position: { x: 0.03, y: 0.009, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
    right: { position: { x: 0.03, y: -0.009, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
  },
}

test('StackchanRuntimeUI skips redundant ui.update calls when AvatarExpression is clean', async () => {
  installAliases()
  const { StackchanRuntimeUI } = (await import('../runtime-ui.js')) as RuntimeUIModule
  const { ui, updates } = createFakeUI()
  let paused = false
  let gazePoint: [number, number, number] | null = null

  const runtimeUI = new StackchanRuntimeUI(ui, {
    getContext: () => ({}) as never,
    getPose: () => defaultPose,
    getGazePoint: () => gazePoint,
    isPaused: () => paused,
  })

  runtimeUI.updateFace(33)
  assert.equal(updates.length, 1)

  runtimeUI.updateFace(33)
  assert.equal(updates.length, 1, 'clean frame must not trigger ui.update')

  runtimeUI.setEmotion(Emotion.HAPPY)
  runtimeUI.setMouthOpen(0.5)
  runtimeUI.updateFace(33)
  assert.equal(updates.length, 2)
  assert.equal(updates[1].emotion, Emotion.HAPPY)
  assert.equal(updates[1].mouth, 0.5)

  runtimeUI.updateFace(33, true)
  assert.equal(updates.length, 3, 'forced update resyncs even when clean')

  paused = true
  runtimeUI.setEmotion(Emotion.SAD)
  runtimeUI.updateFace(33)
  assert.equal(updates.length, 3, 'paused UI suppresses updates while keeping dirty flags')

  paused = false
  gazePoint = [0.5, 0.2, 0]
  runtimeUI.updateFace(33)
  assert.equal(updates.length, 4)
  assert.equal(updates[3].emotion, Emotion.SAD)
  assert.notEqual(updates[3].gazeX, 0)
})

test('StackchanRuntimeUI rejects out-of-range eye and mouth openness via domain-values guards', async () => {
  installAliases()
  const { StackchanRuntimeUI } = (await import('../runtime-ui.js')) as RuntimeUIModule
  const { ui } = createFakeUI()
  const runtimeUI = new StackchanRuntimeUI(ui, {
    getContext: () => ({}) as never,
    getPose: () => defaultPose,
    getGazePoint: () => null,
    isPaused: () => false,
  })

  assert.throws(() => runtimeUI.setEyeOpen('left', -0.1), /between 0 and 1/)
  assert.throws(() => runtimeUI.setEyeOpen('right', Number.NaN), /between 0 and 1/)
  assert.throws(() => runtimeUI.setMouthOpen(1.2), /between 0 and 1/)
  assert.throws(() => runtimeUI.setMouthOpen(Number.POSITIVE_INFINITY), /between 0 and 1/)
})
