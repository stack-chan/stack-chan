import type { ModFeature, ModScope } from 'mod-kit'
import { ok, type Result } from 'stackchan-result'

export const HAND_GESTURE_OPTIONS = [
  { value: 'none', label: '無し' },
  { value: 'rock-paper-scissors', label: 'グーチョキパー' },
  { value: 'clap', label: '拍手' },
  { value: 'thinking', label: '考え中' },
] as const

export type HandGestureName = (typeof HAND_GESTURE_OPTIONS)[number]['value']

export function isHandGestureName(value: unknown): value is HandGestureName {
  return value === 'none' || value === 'rock-paper-scissors' || value === 'clap' || value === 'thinking'
}

export type HandGestureDeps = Readonly<{
  setHandAnimation(animation: HandGestureName): void
  closeDrawer(): void
  addDrawerButton(button: {
    key: string
    label: string
    kind: 'choice'
    value: string
    options: Array<{ value: string; label: string }>
    callback: (value?: string) => void
  }): void
}>

export type HandGestureError = {
  readonly feature: 'hand-gesture'
  readonly reason: string
}

export function installHandGesture(deps: HandGestureDeps, scope: ModScope): Result<void, HandGestureError> {
  let handAnimation: HandGestureName = 'none'
  let disposed = false

  deps.addDrawerButton({
    key: 'handAnimation',
    label: '手',
    kind: 'choice',
    value: handAnimation,
    options: HAND_GESTURE_OPTIONS.map(({ value, label }) => ({ value, label })),
    callback: (value) => {
      if (disposed || !isHandGestureName(value)) return
      handAnimation = value
      deps.setHandAnimation(handAnimation)
      deps.closeDrawer()
    },
  })
  deps.setHandAnimation(handAnimation)

  scope.own(() => {
    disposed = true
    if (handAnimation !== 'none') {
      handAnimation = 'none'
      deps.setHandAnimation('none')
    }
  })

  return ok(undefined)
}

export function createHandGestureFeature<TDeps>(
  selectDeps: (deps: TDeps) => HandGestureDeps,
): ModFeature<TDeps, HandGestureError> {
  return (deps, scope) => installHandGesture(selectDeps(deps), scope)
}
