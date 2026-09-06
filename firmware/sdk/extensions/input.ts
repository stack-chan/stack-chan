import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { TaskContext, TaskHandler, Unsubscribe } from 'stackchan/task'

export type ButtonName = 'primary' | 'secondary' | 'tertiary'
export type HeadTouchEvent = Readonly<{
  gesture: 'press' | 'release' | 'forwardSwipe' | 'backwardSwipe'
  tapDurationMs?: number
}>
export type MotionEvent = Readonly<{
  motion: 'shake' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'
}>
export type InputHandler<Event> = (event: Event, task: TaskContext) => void | Promise<void>
export interface AppInput {
  /** Names follow the available buttons in order; unavailable buttons are never silently ignored. */
  onPress(name: ButtonName, handler: TaskHandler): Unsubscribe
  onHeadTouch(handler: InputHandler<HeadTouchEvent>): Unsubscribe
  onMotion(handler: InputHandler<MotionEvent>): Unsubscribe
}

export function input(app: AppContext): AppInput {
  const inputs = app.input as AppInput
  if (typeof inputs.onMotion !== 'function') throw new StackchanError('UNSUPPORTED', 'Sensor inputs are unavailable')
  return inputs
}
