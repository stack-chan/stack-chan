import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../../testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
writeAliasPackage(hostRoot, 'mac-address', resolve(hostRoot, 'modules/util/sim/mac-address.js'), {
  hasDefaultExport: true,
})
writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), {
  hasDefaultExport: true,
})
writeAliasPackage(hostRoot, 'stackchan-util', resolve(hostRoot, 'modules/util/stackchan-util.js'))

const { GAZE_THRESHOLD, GazeTrackingAggregate, MotionEffectKind, MotionPhase, SETTLE_MARGIN_MS } = await import(
  '../internal/gaze-tracking-state.js'
)

test('gaze within threshold updates body pose and stays idle without enabling torque', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.75 })
  aggregate.setGazePoint([1, 0.2, 0])

  const poll = aggregate.requestPoll(false)
  assert.equal(poll.kind, MotionEffectKind.ReadRotation)
  assert.equal(aggregate.phase, MotionPhase.ReadingPose)

  const sampled = aggregate.onRotationSampled({ success: true, value: { y: 0.1, p: -0.05, r: 0.02 } })
  assert.equal(sampled.kind, MotionEffectKind.None)
  assert.equal(sampled.stopPolling, false)
  assert.equal(aggregate.phase, MotionPhase.Idle)
  assert.equal(aggregate.isMoving, false)
  assert.equal(aggregate.pose.body.rotation.y, 0.1)
  assert.equal(aggregate.pose.body.rotation.p, -0.05)
  assert.equal(aggregate.pose.body.rotation.r, 0.02)
})

test('gaze threshold is evaluated relative to current body rotation', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.6 })
  aggregate.setGazePoint([0, 1, 0])

  aggregate.requestPoll(false)
  const aligned = aggregate.onRotationSampled({ success: true, value: { y: Math.PI / 2, p: 0, r: 0 } })
  assert.equal(aligned.kind, MotionEffectKind.None)
  assert.equal(aggregate.phase, MotionPhase.Idle)

  assert.equal(GAZE_THRESHOLD, Math.PI / 6)
  aggregate.requestPoll(false)
  const misaligned = aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } })
  assert.equal(misaligned.kind, MotionEffectKind.EnableTorque)
  assert.equal(aggregate.phase, MotionPhase.EnablingTorque)
})

test('full gaze-tracking cycle computes target rotation, settle delay, and reuses the effect slot', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.75 })
  aggregate.setGazePoint([1, 2, 2])

  const pollEffect = aggregate.requestPoll(false)
  assert.equal(pollEffect.kind, MotionEffectKind.ReadRotation)

  const torqueEffect = aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } })
  assert.equal(torqueEffect, pollEffect)
  assert.equal(torqueEffect.kind, MotionEffectKind.EnableTorque)
  assert.equal(torqueEffect.torque, true)
  assert.equal(aggregate.phase, MotionPhase.EnablingTorque)
  assert.equal(aggregate.isMoving, true)
  assert.equal(aggregate.isUpdating, true)

  const applyEffect = aggregate.onTorqueEnabled()
  assert.equal(applyEffect, pollEffect)
  assert.equal(applyEffect.kind, MotionEffectKind.ApplyRotation)
  assert.equal(applyEffect.durationSeconds, 0.75)
  const expectedPitch = -Math.atan2(2, Math.sqrt(1 ** 2 + 2 ** 2))
  assert.ok(Math.abs(applyEffect.targetRotation.y - Math.atan2(2, 1)) < 1e-6)
  assert.ok(Math.abs(applyEffect.targetRotation.p - expectedPitch) < 1e-6)
  assert.equal(aggregate.phase, MotionPhase.ApplyingRotation)

  const settleEffect = aggregate.onMotionApplied()
  assert.equal(settleEffect, pollEffect)
  assert.equal(settleEffect.kind, MotionEffectKind.ScheduleTorqueRelease)
  assert.equal(settleEffect.settleDelayMs, 750 + SETTLE_MARGIN_MS)
  assert.equal(aggregate.phase, MotionPhase.Settling)
  assert.equal(aggregate.isMoving, true)
  assert.equal(aggregate.isUpdating, false)

  const midMovePoll = aggregate.requestPoll(false)
  assert.equal(midMovePoll.kind, MotionEffectKind.ReadRotation)
  assert.equal(aggregate.isUpdating, true)
  const midMoveSample = aggregate.onRotationSampled({ success: true, value: { y: 0.5, p: -0.3, r: 0 } })
  assert.equal(midMoveSample.kind, MotionEffectKind.None)
  assert.equal(aggregate.phase, MotionPhase.Settling)
  assert.equal(aggregate.isUpdating, false)
  assert.equal(aggregate.pose.body.rotation.y, 0.5)

  const releaseEffect = aggregate.onSettleElapsed(true)
  assert.equal(releaseEffect, pollEffect)
  assert.equal(releaseEffect.kind, MotionEffectKind.ReleaseTorque)
  assert.equal(releaseEffect.torque, true)
  assert.equal(aggregate.phase, MotionPhase.ReleasingTorque)

  const doneEffect = aggregate.onTorqueReleased()
  assert.equal(doneEffect, pollEffect)
  assert.equal(doneEffect.kind, MotionEffectKind.None)
  assert.equal(doneEffect.stopPolling, false)
  assert.equal(aggregate.phase, MotionPhase.Idle)
  assert.equal(aggregate.isMoving, false)
})

test('clearing gaze during motion defers polling stop until torque release completes', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.5 })
  aggregate.setGazePoint([1, 2, 0])

  aggregate.requestPoll(false)
  aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } })
  aggregate.onTorqueEnabled()
  aggregate.onMotionApplied()

  aggregate.setGazePoint(null)
  assert.equal(aggregate.shouldStopPolling, false)

  const releaseEffect = aggregate.onSettleElapsed(false)
  assert.equal(releaseEffect.kind, MotionEffectKind.ReleaseTorque)
  assert.equal(releaseEffect.torque, false)
  assert.equal(releaseEffect.stopPolling, false)

  const doneEffect = aggregate.onTorqueReleased()
  assert.equal(doneEffect.kind, MotionEffectKind.None)
  assert.equal(doneEffect.stopPolling, true)
  assert.equal(aggregate.shouldStopPolling, true)
})

test('paused polls and active temporary motion suppress gaze moves', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.5 })
  aggregate.setGazePoint([1, 2, 0])

  const pausedEffect = aggregate.requestPoll(true)
  assert.equal(pausedEffect.kind, MotionEffectKind.None)
  assert.equal(aggregate.phase, MotionPhase.Idle)

  aggregate.requestPoll(false)
  const suppressed = aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } }, true)
  assert.equal(suppressed.kind, MotionEffectKind.None)
  assert.equal(aggregate.phase, MotionPhase.Idle)
  assert.equal(aggregate.isMoving, false)
})

test('onError and reset recover to Idle and ignore stale transitions', () => {
  const aggregate = new GazeTrackingAggregate({ sampleMotionDuration: () => 0.5 })
  aggregate.setGazePoint([1, 2, 0])

  aggregate.requestPoll(false)
  aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } })
  assert.equal(aggregate.phase, MotionPhase.EnablingTorque)

  aggregate.setGazePoint(null)
  const errorEffect = aggregate.onError()
  assert.equal(errorEffect.kind, MotionEffectKind.None)
  assert.equal(errorEffect.stopPolling, true)
  assert.equal(aggregate.phase, MotionPhase.Idle)
  assert.equal(aggregate.isMoving, false)
  assert.equal(aggregate.isUpdating, false)

  assert.equal(aggregate.onTorqueEnabled().kind, MotionEffectKind.None)
  assert.equal(aggregate.onMotionApplied().kind, MotionEffectKind.None)
  assert.equal(aggregate.onSettleElapsed(false).kind, MotionEffectKind.None)
  assert.equal(aggregate.onTorqueReleased().kind, MotionEffectKind.None)

  aggregate.setGazePoint([1, 2, 0])
  aggregate.requestPoll(false)
  aggregate.onRotationSampled({ success: true, value: { y: 0, p: 0, r: 0 } })
  aggregate.onTorqueEnabled()
  aggregate.onMotionApplied()
  aggregate.requestPoll(false)
  assert.equal(aggregate.isUpdating, true)
  const readErr = aggregate.onPoseReadError()
  assert.equal(readErr.kind, MotionEffectKind.None)
  assert.equal(aggregate.phase, MotionPhase.Settling)
  assert.equal(aggregate.isUpdating, false)

  aggregate.reset()
  assert.equal(aggregate.phase, MotionPhase.Idle)
  assert.equal(aggregate.isMoving, false)
  assert.equal(aggregate.isUpdating, false)
})
