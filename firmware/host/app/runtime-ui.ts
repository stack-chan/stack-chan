import type {
  DrawerButtonSpec,
  DrawerButtonViewSpec,
  DrawerCapability,
  RobotUI,
  ShowBalloonOptions,
  StackchanContext,
  UIEffect,
} from 'capabilities'
import { SpeechBalloon } from 'effects/speech-balloon'
import { createFaceState, type Emotion, type FaceState, type FaceThemeKey, setColorRGB } from 'face-state'
import {
  type Pose,
  type Rotation,
  type Vector3,
  writeBodyRelativeVector3,
  writePositionRelativeVector3,
  writeRotationFromVector3,
} from 'stackchan-util'

const LEFT_RIGHT = Object.freeze(['left', 'right'] as const)

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

export class StackchanRuntimeUI {
  #balloon: UIEffect | null = null
  #drawerButtonSpecs = new Map<string, DrawerButtonSpec>()
  #drawerButtonStates = new Map<string, boolean>()
  #drawerRegistry: DrawerCapability
  #emotion: Emotion
  #eyeGazePoint: Vector3 = [0, 0, 0]
  #eyeGazeRotation: Rotation = { y: 0, p: 0, r: 0 }
  #faceState: FaceState
  #mouthOpen = 0
  #options: RuntimeUIOptions
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #ui: RobotUI

  constructor(ui: RobotUI, options: RuntimeUIOptions) {
    this.#ui = ui
    this.#options = options
    this.#faceState = createFaceState()
    this.#emotion = this.#faceState.emotion
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
  }

  showBalloon(text: string, option: ShowBalloonOptions = {}) {
    if (this.#balloon != null) {
      this.hideBalloon()
    }
    this.#balloon = new SpeechBalloon({ ...option, text })
    this.#ui.addEffect(this.#balloon)
  }

  hideBalloon() {
    if (this.#balloon != null) {
      this.#ui.removeEffect(this.#balloon)
      this.#balloon = null
    }
  }

  setColor(key: FaceThemeKey, r: number, g: number, b: number): void {
    setColorRGB(this.#faceState.theme[key], r, g, b)
  }

  setEmotion(emotion: Emotion) {
    this.#emotion = emotion
  }

  setMouthOpen(value: number) {
    if (value < 0 || value > 1) {
      throw new Error('value must be between 0 and 1')
    }
    this.#mouthOpen = value
  }

  updateFace(interval: number) {
    if (this.#options.isPaused()) {
      return
    }

    const pose = this.#options.getPose()
    const gazePoint = this.#options.getGazePoint()
    this.#faceState.mouth.open = this.#mouthOpen
    this.#faceState.emotion = this.#emotion

    if (gazePoint != null) {
      writeBodyRelativeVector3(this.#relativeGazePoint, gazePoint, pose.body.rotation)
      for (const key of LEFT_RIGHT) {
        const pos = pose.eyes[key].position
        writePositionRelativeVector3(this.#eyeGazePoint, this.#relativeGazePoint, pos)
        writeRotationFromVector3(this.#eyeGazeRotation, this.#eyeGazePoint)
        const eye = this.#faceState.eyes[key]
        eye.gazeX = Math.cos(this.#eyeGazeRotation.y)
        eye.gazeY = Math.cos(this.#eyeGazeRotation.p)
      }
    }

    this.#ui.update(interval, this.#faceState)
  }

  private addDrawerButton({ key, label, callback, kind, initialState, value, options, icon }: DrawerButtonSpec): void {
    const spec = { key, label, callback, kind, initialState, value, options, icon }
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
