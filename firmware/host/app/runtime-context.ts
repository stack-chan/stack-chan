import type { RobotCamera } from 'camera'
import type { Button, Driver, RobotUI, StackchanContext, TTS } from 'capabilities'
import type { Emotion, FaceThemeKey } from 'face-state'
import type IMU from 'imu'
import type Led from 'led'
import type Microphone from 'microphone'
import { StackchanRuntimeUI } from 'runtime-ui'
import { generateDeviceSeed, type Maybe, noop, type Pose, Rotation, randomBetween, Vector3 } from 'stackchan-util'
import Timer from 'timer'
import type Tone from 'tone'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'

const INTERVAL_FACE = 1000 / 30
const INTERVAL_POSE = 1000 / 10

const NULL_CAMERA: RobotCamera = {
  start() {},
  stop() {},
  async capture() {
    return undefined
  },
}

const buttonNames = ['a', 'b', 'c', 'power'] as const
type ButtonName = (typeof buttonNames)[number]

/**
 * The constructor parameters of the runtime context.
 */
type RuntimeContextConstructorParam<T extends string> = {
  driver: Driver
  ui: RobotUI
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
  touchPanel?: TouchPanel
  imu?: IMU
  microphone?: Microphone
  camera?: RobotCamera
  tone?: Tone
  led?: Record<string, Led>
}

export class StackchanRuntimeContext {
  /**
   * App-owned runtime context that drives hardware, UI, and product behavior.
   */
  #gazePoint: Vector3 | null = null
  #pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  seed: number
  #tts: TTS
  #driver: Driver
  #button: { [key in ButtonName]: Button }
  #touch: Touch
  #touchPanel: TouchPanel | undefined
  #imu: IMU | undefined
  #microphone: Microphone
  #camera: RobotCamera
  #tone: Tone
  #led: Record<string, InstanceType<typeof Led>>
  #isMoving: boolean
  #uiRuntime: StackchanRuntimeUI
  #paused: boolean
  #updatePoseHandler: Timer
  #updateFaceHandler: Timer
  updating: boolean
  constructor(params: RuntimeContextConstructorParam<ButtonName>) {
    this.seed = generateDeviceSeed()
    this.#paused = false
    this.#uiRuntime = new StackchanRuntimeUI(params.ui, {
      getContext: () => this as unknown as StackchanContext,
      getPose: () => this.#pose,
      getGazePoint: () => this.#gazePoint,
      isPaused: () => this.#paused,
    })
    this.useDriver(params.driver)
    this.useTTS(params.tts)
    this.#isMoving = false
    this.#button = params.button
    this.#touch = params.touch
    this.#touchPanel = params.touchPanel
    this.#touchPanel?.start()
    this.#imu = params.imu
    this.#microphone = params.microphone
    this.#camera = params.camera ?? NULL_CAMERA
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
    void this.#updatePoseHandler
    void this.#updateFaceHandler
  }

  /**
   * Set a TTS instance and register callbacks.
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
        this.#uiRuntime.setMouthOpen(0)
      } else {
        this.#uiRuntime.setMouthOpen(Math.min(volume / 2000, 1.0))
      }
    }
    this.#tts.onDone = () => {
      this.#uiRuntime.setMouthOpen(0)
    }
  }

  /**
   * Set a UI controller instance.
   *
   * @param ui - UI controller instance
   */
  useUI(ui: RobotUI) {
    this.#uiRuntime.useUI(ui)
  }

  /**
   * Set a driver instance and register callbacks.
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
   * get top touch panel
   *
   * @returns TouchPanel instance
   */
  get touchPanel(): TouchPanel | undefined {
    return this.#touchPanel
  }

  /**
   * get IMU sensor
   *
   * @returns IMU instance
   */
  get imu(): IMU | undefined {
    return this.#imu
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
   * get Camera
   *
   * @returns Camera instance
   */
  get camera() {
    return this.#camera
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

  async record(durationMilliSec?: number): Promise<ArrayBuffer> {
    if (!this.#microphone) {
      throw Error('This device does not support a microphone.')
    }
    return this.#microphone.record(durationMilliSec)
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

  async playAudio(buffer: ArrayBuffer): Promise<boolean> {
    const player = this.#tone as unknown as { play?: (buffer: ArrayBuffer) => Promise<boolean> | boolean } | undefined
    return (await player?.play?.(buffer)) ?? false
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
    this.#uiRuntime.showBalloon(text, option)
  }

  /**
   * Hide balloon decorator
   */
  hideBalloon() {
    this.#uiRuntime.hideBalloon()
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
  setColor(key: FaceThemeKey, r: number, g: number, b: number): void {
    this.#uiRuntime.setColor(key, r, g, b)
  }

  /**
   * Set the emotion of the robot.
   * The emotion may (or may not) affect the way the robot moves
   * and its facial expressions.
   *
   * @param emotion - emotion
   */
  setEmotion(emotion: Emotion) {
    this.#uiRuntime.setEmotion(emotion)
  }

  setMouthOpen(value: number) {
    this.#uiRuntime.setMouthOpen(value)
  }

  get driver(): Driver {
    return this.#driver
  }

  get tts(): TTS {
    return this.#tts
  }

  get ui(): RobotUI {
    return this.#uiRuntime.ui
  }

  get drawer() {
    return this.#uiRuntime.drawer
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
   * to modify the face state and pass it to RobotUI#update.
   */
  updateFace() {
    this.#uiRuntime.updateFace(INTERVAL_FACE)
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
