import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { TaskContext, TaskHandler, Unsubscribe } from 'stackchan/task'

export type FaceStyle = 'default' | 'simple' | 'dog' | 'image'
export type HandAnimation = 'none' | 'rock-paper-scissors' | 'clap' | 'thinking'
export type Emoticon = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'
export type MenuLabel = Readonly<{ id: string; label: string }>
export type MenuOption<Value extends string = string> = Readonly<{ value: Value; label: string; color?: string }>
export type MenuControl<Value> = Readonly<{ setValue(value: Value): void; close(): void }>
export type ChoiceOptions<Value extends string = string> = MenuLabel & {
  readonly value: Value
  readonly options: readonly MenuOption<Value>[]
}
export type ToggleOptions = MenuLabel & { readonly value: boolean }
export type ChangeHandler<Value> = (value: Value, task: TaskContext) => void | Promise<void>

/** App-owned controls and appearance; no Piu or controller objects cross this boundary. */
type BasicUI = AppContext['ui']
export interface AppUI extends BasicUI {
  readonly faceStyle: FaceStyle
  addAction(options: MenuLabel, handler: TaskHandler): Unsubscribe
  addChoice<Value extends string>(options: ChoiceOptions<Value>, handler: ChangeHandler<Value>): MenuControl<Value>
  addToggle(options: ToggleOptions, handler: ChangeHandler<boolean>): MenuControl<boolean>
  closeMenu(): void
  setFaceStyle(style: FaceStyle): void
  setHandAnimation(animation: HandAnimation): void
  setEmoticon(emoticon: Emoticon | null): void
  localize(key: string, parameters?: Readonly<Record<string, string | number>>): string
}

/** Use the additional UI facet on the same context and lifecycle as the basic SDK. */
export function ui(app: AppContext): AppUI {
  const view = app.ui as AppUI
  if (typeof view.addAction !== 'function') throw new StackchanError('UNSUPPORTED', 'UI controls are unavailable')
  return view
}
