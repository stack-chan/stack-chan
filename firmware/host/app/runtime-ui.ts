import { AvatarExpression, ExpressionDirty } from 'avatar-expression'
import type {
  DrawerButtonSpec,
  DrawerButtonViewSpec,
  DrawerCapability,
  RobotUI,
  ShowBalloonOptions,
  StackchanContext,
  UIEffect,
} from 'capabilities'
import { isMouthOpenRatio, isNormalizedGain } from 'domain-values'
import { SpeechBalloon } from 'effects/speech-balloon'
import type { Emotion, FaceEyeKey, FaceThemeKey } from 'face-state'
import type { Pose, Vector3 } from 'stackchan-util'

type RuntimeUIPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

type RuntimeUIOptions = {
  getContext: () => StackchanContext
  getPose: () => RuntimeUIPose
  getGazePoint: () => Vector3 | null | undefined
  isPaused: () => boolean
}

type BalloonLayout = ShowBalloonOptions & { rows?: number }

const BALLOON_OPTION_KEYS = ['left', 'right', 'top', 'bottom', 'width', 'height', 'tail', 'rows'] as const

type SpeechBalloonBehavior = {
  setText?: (content: UIEffect, text: string) => void
  setLines?: (content: UIEffect, lines: readonly string[]) => void
}

function sameBalloonOptions(current: BalloonLayout | null, next: BalloonLayout): boolean {
  if (!current) return false
  return BALLOON_OPTION_KEYS.every((key) => current[key] === next[key])
}

export class StackchanRuntimeUI {
  #balloon: UIEffect | null = null
  #balloonOptions: BalloonLayout | null = null
  #drawerButtonSpecs = new Map<string, DrawerButtonSpec>()
  #drawerButtonStates = new Map<string, boolean>()
  #drawerRegistry: DrawerCapability
  #expression = new AvatarExpression()
  #options: RuntimeUIOptions
  #ui: RobotUI

  constructor(ui: RobotUI, options: RuntimeUIOptions) {
    this.#ui = ui
    this.#options = options
    this.#drawerRegistry = {
      addDrawerButton: (button) => this.addDrawerButton(button),
      removeDrawerButton: (key) => this.removeDrawerButton(key),
      clearDrawerButtons: () => this.clearDrawerButtons(),
      setDrawerButtonState: (key, active) => this.setDrawerButtonState(key, active),
    }
  }

  get drawer(): DrawerCapability {
    return this.#drawerRegistry
  }

  get ui(): RobotUI {
    return this.#ui
  }

  useUI(ui: RobotUI) {
    if (ui === this.#ui) return
    this.detachDrawerBindings()
    this.#ui = ui
    this.rebuildDrawerBindings()
    this.#ui.update(0, this.#expression.faceState)
  }

  showBalloon(text: string, option: ShowBalloonOptions = {}) {
    this.#showBalloon(text, option)
  }

  #showBalloon(text: string, option: BalloonLayout) {
    if (this.#balloon != null && sameBalloonOptions(this.#balloonOptions, option)) {
      const behavior = this.#balloon.behavior as SpeechBalloonBehavior | undefined
      if (behavior?.setText) {
        behavior.setText(this.#balloon, text)
        return
      }
    }
    this.hideBalloon()
    this.#balloon = new SpeechBalloon({ ...option, text })
    this.#balloonOptions = { ...option }
    this.#ui.addEffect(this.#balloon)
  }

  showBalloonLines(lines: readonly string[], option: ShowBalloonOptions = {}) {
    if (lines.length < 1 || lines.length > 8) throw new RangeError('1..8 balloon rows required')
    this.#showBalloon('', { ...option, rows: lines.length })
    const behavior = this.#balloon?.behavior as SpeechBalloonBehavior | undefined
    if (this.#balloon) behavior?.setLines?.(this.#balloon, lines)
  }

  hideBalloon() {
    if (this.#balloon != null) {
      this.#ui.removeEffect(this.#balloon)
      this.#balloon = null
      this.#balloonOptions = null
    }
  }

  setColor(key: FaceThemeKey, r: number, g: number, b: number): void {
    this.#expression.setColor(key, r, g, b)
  }

  setEmotion(emotion: Emotion) {
    this.#expression.setEmotion(emotion)
  }

  setEyeOpen(key: FaceEyeKey, value: number) {
    if (!isNormalizedGain(value)) {
      throw new Error('value must be between 0 and 1')
    }
    this.#expression.setEyeOpen(key, value)
  }

  setMouthOpen(value: number) {
    if (!isMouthOpenRatio(value)) {
      throw new Error('value must be between 0 and 1')
    }
    this.#expression.setMouthOpen(value)
  }

  updateFace(interval: number, force = false) {
    if (this.#options.isPaused()) {
      return
    }

    const pose = this.#options.getPose()
    const gazePoint = this.#options.getGazePoint()
    this.#expression.projectGaze(gazePoint, pose)
    const dirty = this.#expression.consumeDirtyFlags()
    if (!force && dirty === ExpressionDirty.None) {
      return
    }

    this.#ui.update(interval, this.#expression.faceState)
  }

  private addDrawerButton({ key, label, callback, kind, initialState, value, options, icon }: DrawerButtonSpec): void {
    const spec = {
      key,
      label,
      callback,
      kind,
      initialState,
      value,
      options,
      icon,
    }
    this.#drawerButtonSpecs.set(key, spec)
    this.bindDrawerButton(spec)
    this.#ui.addDrawerButton({ key, label, kind, value, options, icon })
    if (initialState !== undefined) {
      this.setDrawerButtonState(key, initialState)
    }
  }

  private bindDrawerButton({ key, callback }: DrawerButtonSpec): void {
    const runCallback = (value?: string) => {
      try {
        const result = callback(this.#options.getContext(), value)
        if (result && typeof (result as { catch?: (handler: (err: unknown) => void) => void }).catch === 'function') {
          ;(result as { catch: (handler: (err: unknown) => void) => void }).catch((err: unknown) => {
            trace(`[DrawerButton] callback rejected key=${key} err=${String(err)}\n`)
          })
        }
      } catch (err) {
        trace(`[DrawerButton] callback error key=${key} err=${String(err)}\n`)
      }
    }
    if (!this.#ui.bindDrawerAction(key, runCallback)) {
      trace(`[DrawerButton] skip binding key=${key}\n`)
    }
  }

  private removeDrawerButton(key: string): void {
    this.#drawerButtonSpecs.delete(key)
    this.#drawerButtonStates.delete(key)
    this.#ui.unbindDrawerAction(key)
    this.#ui.removeDrawerButton(key)
  }

  private clearDrawerButtons(): void {
    this.detachDrawerBindings()
    this.#drawerButtonSpecs.clear()
    this.#drawerButtonStates.clear()
    this.#ui.setDrawerButtons([])
  }

  private setDrawerButtonState(key: string, active: boolean): void {
    this.#drawerButtonStates.set(key, active)
    this.#ui.setDrawerButtonState(key, active)
  }

  private detachDrawerBindings(): void {
    for (const key of this.#drawerButtonSpecs.keys()) {
      this.#ui.unbindDrawerAction(key)
    }
  }

  private rebuildDrawerBindings(): void {
    const buttons: DrawerButtonViewSpec[] = []
    for (const spec of this.#drawerButtonSpecs.values()) {
      this.bindDrawerButton(spec)
      buttons.push({
        key: spec.key,
        label: spec.label,
        kind: spec.kind,
        value: spec.value,
        options: spec.options,
        icon: spec.icon,
      })
    }

    this.#ui.setDrawerButtons(buttons)
    for (const [key, active] of this.#drawerButtonStates) {
      this.#ui.setDrawerButtonState(key, active)
    }
  }
}
