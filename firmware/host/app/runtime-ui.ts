import type { DrawerButtonSpec, DrawerCapability, RobotUI, StackchanContext, UIEffect } from 'capabilities'
import { SpeechBalloon } from 'effects/speech-balloon'
import { createFaceState, type Emotion, type FaceState, type FaceThemeKey, setColorRGB } from 'face-state'
import { type Pose, Rotation, Vector3 } from 'stackchan-util'

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
  #drawerBehavior: Record<string, unknown> | null = null
  #drawerRegistry: DrawerCapability
  #emotion: Emotion
  #faceState: FaceState
  #mouthOpen = 0
  #options: RuntimeUIOptions
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
    this.#ui = ui
  }

  showBalloon(
    text: string,
    option: {
      left?: number
      right?: number
      top?: number
      bottom?: number
      width?: number
      height?: number
    } = {
      right: 20,
      top: 10,
      width: 80,
    },
  ) {
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
      const relativeGazePoint = Vector3.rotate(gazePoint, {
        r: 0.0,
        y: -pose.body.rotation.y,
        p: -pose.body.rotation.p,
      })
      for (const key of LEFT_RIGHT) {
        const pos = pose.eyes[key].position
        const relative = Vector3.sub(relativeGazePoint, [pos.x, pos.y, pos.z])
        const { y, p } = Rotation.fromVector3(relative)
        const eye = this.#faceState.eyes[key]
        eye.gazeX = Math.cos(y)
        eye.gazeY = Math.cos(p)
      }
    }

    this.#ui.update(interval, this.#faceState)
  }

  private getDrawerController():
    | {
        setButtons?: (buttons: unknown[]) => void
        addButton?: (button: unknown) => void
        removeButton?: (key: string) => void
        setButtonState?: (key: string, active: boolean) => void
      }
    | undefined {
    const app = this.#ui?.application as { drawerController?: unknown } | undefined
    return app?.drawerController as
      | {
          setButtons?: (buttons: unknown[]) => void
          addButton?: (button: unknown) => void
          removeButton?: (key: string) => void
          setButtonState?: (key: string, active: boolean) => void
        }
      | undefined
  }

  private ensureDrawerBehavior(): Record<string, unknown> | null {
    const app = this.#ui?.application as { behavior?: Record<string, unknown> } | undefined
    if (!app) return null
    if (!app.behavior) {
      app.behavior = new (class extends Behavior {})() as unknown as Record<string, unknown>
    }
    this.#drawerBehavior = app.behavior
    return this.#drawerBehavior
  }

  private addDrawerButton({ key, label, callback, kind, initialState }: DrawerButtonSpec): void {
    const behavior = this.ensureDrawerBehavior()
    if (behavior) {
      const runCallback = () => {
        try {
          const result = callback(this.#options.getContext())
          if (result && typeof (result as { catch?: (handler: (err: unknown) => void) => void }).catch === 'function') {
            ;(result as { catch: (handler: (err: unknown) => void) => void }).catch((err: unknown) => {
              trace(`[DrawerButton] callback rejected key=${key} err=${String(err)}\n`)
            })
          }
        } catch (err) {
          trace(`[DrawerButton] callback error key=${key} err=${String(err)}\n`)
        }
      }
      const desc =
        Object.getOwnPropertyDescriptor(behavior, key) ??
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(behavior), key)
      if (desc && desc.writable === false) {
        trace(`[DrawerButton] skip binding key=${key} (not writable)\n`)
      } else {
        ;(behavior as Record<string, () => void>)[key] = runCallback
      }
    }
    const controller = this.getDrawerController()
    controller?.addButton?.({ key, label, kind })
    if (initialState !== undefined) {
      this.setDrawerButtonState(key, initialState)
    }
  }

  private removeDrawerButton(key: string): void {
    if (this.#drawerBehavior) {
      delete (this.#drawerBehavior as Record<string, unknown>)[key]
    }
    const controller = this.getDrawerController()
    controller?.removeButton?.(key)
  }

  private clearDrawerButtons(): void {
    const controller = this.getDrawerController()
    controller?.setButtons?.([])
  }

  private setDrawerButtonState(key: string, active: boolean): void {
    const controller = this.getDrawerController()
    controller?.setButtonState?.(key, active)
  }
}
