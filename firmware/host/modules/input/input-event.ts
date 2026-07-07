import type { MotionType } from 'imu-motion'
import type { TouchPanelGestureType } from 'touch-panel-gesture'

export type ButtonInputEvent = {
  kind: 'button'
  name: 'a' | 'b' | 'c' | 'power'
  pressed: boolean
  ticks: number
}

export type TouchInputEvent = {
  kind: 'touch'
  phase: 'began' | 'moved' | 'ended'
  id: number
  x: number
  y: number
  ticks: number
}

export type TouchPanelInputEvent = {
  kind: 'touch-panel'
  gesture: TouchPanelGestureType
  position: number
  intensity: number
  ticks: number
}

export type IMUInputEvent = {
  kind: 'imu'
  motion: MotionType
  ticks: number
}

export type InputEvent = ButtonInputEvent | TouchInputEvent | TouchPanelInputEvent | IMUInputEvent

export function createButtonInputEvent(
  name: ButtonInputEvent['name'],
  pressed: boolean,
  ticks: number,
): ButtonInputEvent {
  return { kind: 'button', name, pressed, ticks }
}

export function createTouchInputEvent(
  phase: TouchInputEvent['phase'],
  id: number,
  x: number,
  y: number,
  ticks: number,
): TouchInputEvent {
  return { kind: 'touch', phase, id, x, y, ticks }
}

export function createTouchPanelInputEvent(
  gesture: TouchPanelGestureType,
  position: number,
  intensity: number,
  ticks: number,
): TouchPanelInputEvent {
  return { kind: 'touch-panel', gesture, position, intensity, ticks }
}

export function createIMUInputEvent(motion: MotionType, ticks: number): IMUInputEvent {
  return { kind: 'imu', motion, ticks }
}
