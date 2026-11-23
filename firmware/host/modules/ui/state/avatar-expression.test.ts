import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import { mouthOpenRatio } from '../../util/domain-values.js'
import { Emotion } from './face-state.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
writeAliasPackage(hostRoot, 'domain-values', resolve(hostRoot, 'modules/util/domain-values.js'))
writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))

const { AvatarExpression, ExpressionDirty } = await import('./avatar-expression.js')

const DEFAULT_POSE = {
  body: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0, p: 0, r: 0 },
  },
  eyes: {
    left: {
      position: { x: 0.03, y: 0.02, z: 0 },
      rotation: { y: 0, p: 0, r: 0 },
    },
    right: {
      position: { x: 0.03, y: -0.02, z: 0 },
      rotation: { y: 0, p: 0, r: 0 },
    },
  },
} as const

test('AvatarExpression starts dirty and reuses a single FaceState object across updates', () => {
  const expression = new AvatarExpression()
  const initialState = expression.faceState

  assert.equal(expression.isDirty, true)
  assert.equal(expression.dirtyFlags, ExpressionDirty.All)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.All)
  assert.equal(expression.isDirty, false)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.None)

  assert.equal(expression.setMouthOpen(mouthOpenRatio(0.45)), true)
  assert.equal(expression.setMouthOpen(0.45), false)
  assert.equal(expression.faceState, initialState)
  assert.equal(expression.faceState.mouth.open, 0.45)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.Mouth)

  assert.equal(expression.setMouthOpen(2.5), true)
  assert.equal(expression.faceState.mouth.open, 1)
  assert.equal(expression.setMouthOpen(-0.5), true)
  assert.equal(expression.faceState.mouth.open, 0)
  assert.equal(expression.setMouthOpen(Number.NaN), false)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.Mouth)
})

test('AvatarExpression tracks per-channel dirty bits for eyes, emotion, theme, and reset', () => {
  const expression = new AvatarExpression()
  expression.consumeDirtyFlags()

  assert.equal(expression.setEyeOpen('left', 0.25), true)
  assert.equal(expression.setEyeOpen('left', 0.25), false)
  assert.equal(expression.setEmotion(Emotion.HAPPY), true)
  assert.equal(expression.setEmotion(Emotion.HAPPY), false)
  assert.equal(expression.setColor('primary', 0x10, 0x20, 0x30), true)
  assert.equal(expression.setColor('primary', 0x10, 0x20, 0x30), false)

  const flags = expression.consumeDirtyFlags()
  assert.equal(flags, ExpressionDirty.Eyes | ExpressionDirty.Emotion | ExpressionDirty.Theme)
  assert.equal(expression.faceState.eyes.left.open, 0.25)
  assert.equal(expression.faceState.emotion, Emotion.HAPPY)
  assert.deepEqual(expression.faceState.theme.primary, { r: 0x10, g: 0x20, b: 0x30 })

  expression.reset()
  assert.equal(expression.dirtyFlags, ExpressionDirty.All)
  assert.equal(expression.faceState.emotion, Emotion.NEUTRAL)
  assert.equal(expression.faceState.eyes.left.open, 1)
  assert.deepEqual(expression.faceState.theme.primary, { r: 0xff, g: 0xff, b: 0xff })
})

test('AvatarExpression projects 3D gaze into eye coordinates and marks Gaze dirty only on change', () => {
  const expression = new AvatarExpression()
  expression.consumeDirtyFlags()

  assert.equal(expression.projectGaze(null, DEFAULT_POSE), false)
  assert.equal(expression.dirtyFlags, ExpressionDirty.None)

  assert.equal(expression.projectGaze([0.5, 0.2, 0.1], DEFAULT_POSE), true)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.Gaze)
  assert.equal(expression.projectGaze([0.5, 0.2, 0.1], DEFAULT_POSE), false)
  assert.equal(expression.dirtyFlags, ExpressionDirty.None)

  assert.ok(Number.isFinite(expression.faceState.eyes.left.gazeX))
  assert.ok(Number.isFinite(expression.faceState.eyes.left.gazeY))
  assert.ok(Number.isFinite(expression.faceState.eyes.right.gazeX))
  assert.ok(Number.isFinite(expression.faceState.eyes.right.gazeY))

  const rotatedPose = {
    ...DEFAULT_POSE,
    body: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { y: Math.PI / 6, p: 0, r: 0 },
    },
  }
  assert.equal(expression.projectGaze([0.5, 0.2, 0.1], rotatedPose), true)
  assert.equal(expression.consumeDirtyFlags(), ExpressionDirty.Gaze)
})
