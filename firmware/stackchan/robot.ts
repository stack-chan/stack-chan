import Timer from 'timer'
import { Vector3, type Pose, Rotation, type Maybe, noop, randomBetween, generateDeviceSeed } from 'stackchan-util'
import { type FaceContext, type Emotion, createFaceContext } from 'face-context'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type Digital from 'embedded:io/digital'
import type Touch from 'touch'
import type Microphone from 'microphone'
import type Tone from 'tone'
import type Led from 'led'
import { SpeechBalloon } from 'effects/speech-balloon'

const INTERVAL_FACE = 1000 / 30
const INTERVAL_POSE = 1000 / 10
const HEX_DIGITS = '0123456789abcdef'

function toHexByte(value: number): string {
  const clamped = Math.max(0, Math.min(255, value | 0))
  return `${HEX_DIGITS[(clamped >> 4) & 0x0f]}${HEX_DIGITS[clamped & 0x0f]}`
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

/**
 * The Driver for the actuator
 */
export type Driver = {
  applyRotation: (ori: Rotation, time?: number) => Promise<void>
  getRotation: () => Promise<Maybe<Rotation>>
  setTorque: (torque: boolean) => Promise<void>
  onAttached?: () => void
  onDetached?: () => void
}

/**
 * The text-to-speech engine
 */
export type TTS = {
  stream: (text: string, volume?: number) => Promise<void>
  onPlayed?: (volume: number) => void
  onDone?: () => void
}

/**
 * The display renderer
 */
export type Renderer = {
  update: (interval: number, faceContext: Readonly<FaceContext>) => void
  addDecorator(decorator: FaceDecorator): void
  removeDecorator(decorator: FaceDecorator): void
  application?: unknown
  setFace?: (face: PiuContainer) => void
}

export type DrawerButtonRegistration = {
  key: string
  label: string
  callback: (robot: Robot) => unknown
  kind?: 'action' | 'toggle'
  initialState?: boolean
}

type DrawerButtonRegistry = {
  addDrawerButton: (button: DrawerButtonRegistration) => void
  removeDrawerButton: (key: string) => void
  clearDrawerButtons: () => void
  setDrawerButtonState: (key: string, active: boolean) => void
}

export type Button = {
  onChanged: (this: Digital) => void
}

const buttonNames = ['a', 'b', 'c'] as const
type ButtonName = (typeof buttonNames)[number]

/**
 * The constructor parameters of the robot.
 */
type RobotConstructorParam<T extends string> = {
  driver: Driver
  renderer: Renderer
  tts: TTS
  button: { [key in T]: Button }
  pose?: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  touch?: Touch
  microphone?: Microphone
  tone?: Tone
  led?: Record<string, Led>
}

const LEFT_RIGHT = Object.freeze(['left', 'right'])
type FaceDecorator = PiuContent
export class Robot {
  /**
   * A Facade class that provides quick access for Stack-chan features
   *
   * @public
   */
  #gazePoint: Vector3
  #pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  seed: number
  #mouthOpen: number
  #tts: TTS
  #driver: Driver
  #button: { [key in ButtonName]: Button }
  #touch: Touch
  #microphone: Microphone
  #tone: Tone
  #led: Record<string, InstanceType<typeof Led>>
  #isMoving: boolean
  #renderer: Renderer
  #paused: boolean
  #faceContext: FaceContext
  #emotion: Emotion
  #updatePoseHandler: Timer
  #updateFaceHandler: Timer
  #balloon: FaceDecorator
  #drawerCallbacks: Map<string, (robot: Robot) => unknown>
  #drawerRegistry: DrawerButtonRegistry
  #drawerBehavior: Record<string, unknown> | null
  updating: boolean
  constructor(params: RobotConstructorParam<ButtonName>) {
    this.seed = generateDeviceSeed()
    this.useRenderer(params.renderer)
    this.useDriver(params.driver)
    this.useTTS(params.tts)
    this.#isMoving = false
    this.#mouthOpen = 0
    this.#button = params.button
    this.#touch = params.touch
    this.#microphone = params.microphone
    this.#tone = params.tone
    this.#led = params.led ?? {}
    this.#pose = params.pose ?? {
      body: {
        position: {
          x: 0.0,
          y: 0.0,
          z: 0.0,
        },
        rotation: {
          y: 0.0,
          p: 0.0,
          r: 0.0,
        },
      },
      eyes: {
        left: {
          position: {
            x: 0.03,
            y: 0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
        right: {
          position: {
            x: 0.03,
            y: -0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
      },
    }
    this.#updatePoseHandler = Timer.repeat(this.updatePose.bind(this), INTERVAL_POSE)
    this.#updateFaceHandler = Timer.repeat(this.updateFace.bind(this), INTERVAL_FACE)
    this.#paused = false
    this.#faceContext = createFaceContext()
    this.#emotion = this.#faceContext.emotion
    this.#drawerCallbacks = new Map()
    this.#drawerBehavior = null
    this.#drawerRegistry = {
      addDrawerButton: (button) => this.addDrawerButton(button),
      removeDrawerButton: (key) => this.removeDrawerButton(key),
      clearDrawerButtons: () => this.clearDrawerButtons(),
      setDrawerButtonState: (key, active) => this.setDrawerButtonState(key, active),
    }
  }

  /**
   * set a TTS instance to Robot and register callbacks
   *
   * @param tts - TTS class instance
   */
  useTTS(tts: TTS) {
    if (this.#tts != null) {
      this.#tts.onDone = noop
      this.#tts.onPlayed = noop
    }
    this.#tts = tts
    this.#tts.onPlayed = (volume: number) => {
      if (volume === 0) {
        this.#mouthOpen = 0
      } else {
        this.#mouthOpen = Math.min(volume / 2000, 1.0)
      }
    }
    this.#tts.onDone = () => {
      this.#mouthOpen = 0
    }
  }

  /**
   * set a Renderer instance to Robot and register callbacks
   *
   * @param renderer - Renderer class instance
   */
  useRenderer(renderer: Renderer) {
    this.#renderer = renderer
  }

  /**
   * set a Driver instance to Robot and register callbacks
   *
   * @param driver - Driver class instance
   */
  useDriver(driver: Driver) {
    if (this.#driver != null) {
      this.#driver.onDetached?.()
    }
    this.#driver = driver
    this.#driver.onAttached?.()
  }

  /**
   * get Buttons
   *
   * @returns Button instances
   */
  get button() {
    return this.#button
  }

  /**
   * get Touch
   *
   * @returns Touch instances
   */
  get touch() {
    return this.#touch
  }

  /**
   * get Pose
   *
   * @returns pose instances
   */
  get pose() {
    return this.#pose
  }

  /**
   * get Microphone
   *
   * @returns Microphone instance
   */
  get microphone() {
    return this.#microphone
  }

  /**
   * get LED
   *
   * @returns Led instances
   */
  get led() {
    return this.#led
  }

  /**
   * let the robot say things
   *
   * @param text - the key or speech text itself to say
   * @returns the text when speech finishes, otherwise the reason why it fails.
   */
  async say(text: string, volume?: number): Promise<Maybe<string>> {
    return new Promise((resolve, _reject) => {
      this.#tts
        .stream(text, volume)
        .catch((reason) => {
          trace('error\n')
          resolve({
            success: false,
            reason,
          })
        })
        .then(() => {
          resolve({
            success: true,
            value: text,
          })
        })
    })
  }

  async record(_durationSec?: number): Promise<ArrayBuffer> {
    if (!this.#microphone) {
      throw Error('This device does not support a microphone.')
    }
    return this.#microphone.record()
  }

  /**
   * let the robot sound a tone
   * @param hz frequency of tone
   * @param duration duration (unit: millisecond)
   * @returns return when the playback of the tone is completed.
   */
  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    if (volume !== undefined && (volume < 0 || volume > 1)) {
      throw new Error('Volume must be between 0 and 1')
    }
    return this.#tone?.tone(hz, duration, volume)
  }

  /**
   * Move the focus point of the robot.
   * When the robot looks somewhere, it moves its gaze or face direction
   * toward that point.
   * The function lookAt completes synchronously,
   * and the function does not know when to start or finish moving the gaze.
   *
   * @param position - the position of the point to look at
   */
  lookAt(position: Vector3) {
    this.#gazePoint = position
  }

  /**
   * Show balloon decorator
   *
   * @param text - the text on the balloon
   */
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
    this.#renderer.addDecorator(this.#balloon)
  }

  /**
   * Hide balloon decorator
   */
  hideBalloon() {
    if (this.#balloon != null) {
      this.renderer.removeDecorator(this.#balloon)
      this.#balloon = null
    }
  }

  /**
   * Unregister the focus point.
   */
  lookAway() {
    this.#gazePoint = null
  }

  /**
   * Set the pose.
   *
   * @returns void when the robot start moving
   * @experimental
   */
  async setPose(pose: Pose, time?: number): Promise<void> {
    return this.#driver.applyRotation(pose.rotation, time)
  }

  /**
   * Set the actuator torque.
   *
   * @returns void when the robot completes setting the torque
   */
  async setTorque(torque: boolean): Promise<void> {
    return this.#driver.setTorque(torque)
  }

  /**
   * Set the color
   * @param{key} - 'primary' or 'secondary'
   * @param{r} - red value [0-255]
   * @param{g} - green value [0-255]
   * @param{b} - blue value [0-255]
   */
  setColor(key: keyof FaceContext['theme'], r: number, g: number, b: number): void {
    this.#faceContext.theme[key] = rgbToHex(r, g, b)
  }

  /**
   * Set the emotion of the robot.
   * The emotion may (or may not) affect the way the robot moves
   * and its facial expressions.
   *
   * @param emotion - emotion
   */
  setEmotion(emotion: Emotion) {
    this.#emotion = emotion
  }

  setMouthOpen(value: number) {
    if (value < 0 || value > 1) {
      throw new Error('value must be between 0 and 1')
    }
    this.#mouthOpen = value
  }

  get driver(): Driver {
    return this.#driver
  }

  get tts(): TTS {
    return this.#tts
  }

  get renderer(): Renderer {
    return this.#renderer
  }

  get application(): DrawerButtonRegistry {
    return this.#drawerRegistry
  }

  private getDrawerController():
    | {
        setButtons?: (buttons: unknown[]) => void
        addButton?: (button: unknown) => void
        removeButton?: (key: string) => void
        setButtonState?: (key: string, active: boolean) => void
      }
    | undefined {
    const app = this.#renderer?.application as { drawerController?: unknown } | undefined
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
    const app = this.#renderer?.application as { behavior?: Record<string, unknown> } | undefined
    if (!app) return null
    if (!app.behavior) {
      app.behavior = new (class extends Behavior {})() as unknown as Record<string, unknown>
    }
    this.#drawerBehavior = app.behavior
    return this.#drawerBehavior
  }

  private addDrawerButton({ key, label, callback, kind, initialState }: DrawerButtonRegistration): void {
    this.#drawerCallbacks.set(key, callback)
    const behavior = this.ensureDrawerBehavior()
    if (behavior) {
      const runCallback = () => {
        try {
          const result = callback(this)
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
    this.#drawerCallbacks.delete(key)
    if (this.#drawerBehavior) {
      delete (this.#drawerBehavior as Record<string, unknown>)[key]
    }
    const controller = this.getDrawerController()
    controller?.removeButton?.(key)
  }

  private clearDrawerButtons(): void {
    this.#drawerCallbacks.clear()
    const controller = this.getDrawerController()
    controller?.setButtons?.([])
  }

  private setDrawerButtonState(key: string, active: boolean): void {
    const controller = this.getDrawerController()
    controller?.setButtonState?.(key, active)
  }

  pause() {
    this.#paused = true
  }

  resume() {
    this.#paused = false
  }
  /**
   * Update the robot face.
   * Process the robot's emotion, pose, gaze point and so on
   * to modify the face context and passes it to Renderer#update
   */
  updateFace() {
    if (this.#paused) {
      return
    }
    this.#faceContext.mouth.open = this.#mouthOpen

    this.#faceContext.emotion = this.#emotion
    if (this.#gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this.#gazePoint, {
        r: 0.0,
        y: -this.#pose.body.rotation.y,
        p: -this.#pose.body.rotation.p,
      })
      for (const key of LEFT_RIGHT) {
        const pos = this.#pose.eyes[key].position
        const relative = Vector3.sub(relativeGazePoint, [pos.x, pos.y, pos.z])
        const { y, p } = Rotation.fromVector3(relative)
        const eye = this.#faceContext.eyes[key]
        eye.gazeX = Math.cos(y)
        eye.gazeY = Math.cos(p)
      }
    }
    this.#renderer.update(INTERVAL_FACE, this.#faceContext)
  }

  /**
   * Update the robot pose.
   * Get the current pose from the Driver
   * and trigger move if necessary to see the gaze point.
   */
  async updatePose(_id) {
    if (this.updating || this.#paused) {
      return
    }
    this.updating = true
    const result = await this.#driver.getRotation()
    if (result.success) {
      this.#pose.body.rotation = result.value
    }

    if (!this.#isMoving && this.#gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this.#gazePoint, {
        r: 0.0,
        y: -this.#pose.body.rotation.y,
        p: -this.#pose.body.rotation.p,
      })
      const { y, p } = Rotation.fromVector3(relativeGazePoint)
      if (y > Math.PI / 6 || y < -Math.PI / 6 || p > Math.PI / 6 || p < -Math.PI / 6) {
        this.#isMoving = true
        const time = randomBetween(0.5, 1.0)
        await this.#driver.setTorque(true)
        await this.#driver.applyRotation(Rotation.fromVector3(this.#gazePoint), time)
        Timer.set(
          async () => {
            await this.#driver.setTorque(false)
            this.#isMoving = false
          },
          time * 1000 + 50,
        )
      }
    }
    this.updating = false
  }

  /**
   * Turns on an Led with the specified color and optional animation parameters.
   * @param ledName - The name identifier of the Led to control
   * @param r - Red color value (0-255)
   * @param g - Green color value (0-255)
   * @param b - Blue color value (0-255)
   * @param duration - Optional duration in milliseconds for the animation
   * @param index - Optional starting index for the Led animation
   * @param count - Optional number of LEDs to animate
   */
  lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.on(r, g, b, duration, index, count)
    }
  }

  /**
   * Turns off the specified Led.
   *
   * @param ledName - The name of the Led to turn off.
   * @param index - Optional index of the Led to turn off. If not provided, all LEDs of the specified name will be turned off.
   * @param count - Optional number of Led to turn off starting from the index. If not provided, all LEDs will be turned off.
   *
   * @remarks
   * This method checks if the Led with the given name exists before attempting to turn it off.
   */
  lightOff(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.off(index, count)
    }
  }

  /**
   * Blinks an Led with the specified color and interval.
   *
   * @param ledName - The name of the Led to blink.
   * @param r - The red component of the color (0-255).
   * @param g - The green component of the color (0-255).
   * @param b - The blue component of the color (0-255).
   * @param duration - The time in milliseconds between blinks.
   * @param index - Optional index to specify which Led to control if multiple LEDs are present.
   * @param count - Optional number of LEDs to blink. If not provided, it will affect all LEDs from the index to the end.
   */
  lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.blink(r, g, b, duration, index, count)
    }
  }

  /**
   * Displays a rainbow light effect on the specified Led.
   * @param ledName - The name of the Led to apply the rainbow effect to.
   * @param index - Optional starting index for the rainbow effect.
   * @param count - Optional number of Leds to apply the rainbow effect to.
   */
  lightRainbow(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.rainbow(index, count)
    }
  }
}
