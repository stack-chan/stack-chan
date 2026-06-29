import assert from 'node:assert/strict'
import test from 'node:test'
import { createIMUInputEvent, createTouchInputEvent, createTouchPanelInputEvent } from './input-event.js'

test('createTouchInputEvent returns a compact touch event', () => {
  assert.deepEqual(createTouchInputEvent('began', 1, 12, 24, 100), {
    kind: 'touch',
    phase: 'began',
    id: 1,
    x: 12,
    y: 24,
    ticks: 100,
  })
})

test('createTouchPanelInputEvent hides raw Si12T samples', () => {
  assert.deepEqual(createTouchPanelInputEvent('forwardSwipe', 0.5, 3, 150), {
    kind: 'touch-panel',
    gesture: 'forwardSwipe',
    position: 0.5,
    intensity: 3,
    ticks: 150,
  })
})

test('createIMUInputEvent hides raw IMU samples', () => {
  assert.deepEqual(createIMUInputEvent('shake', 200), {
    kind: 'imu',
    motion: 'shake',
    ticks: 200,
  })
})
