import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type {
  AudioCapability,
  ConnectivityCapability,
  ConversationCapability,
  FaceCapability,
  InputCapability,
  LifecycleCapability,
  LightingCapability,
  MotionCapability,
  RobotUI,
  RuntimeUICapability,
  StackchanContext,
} from 'capabilities'
import type { Emotion, FaceThemeKey } from 'face-state'
import { MotionController, type MotionControllerConstructorParam } from 'motion-controller'
import { type RuntimeAudioConstructorParam, StackchanRuntimeAudio } from 'runtime-audio'
import { type RuntimeCameraConstructorParam, StackchanRuntimeCamera } from 'runtime-camera'
import { type RuntimeInputConstructorParam, StackchanRuntimeInput } from 'runtime-input'
import { type RuntimeLightingConstructorParam, StackchanRuntimeLighting } from 'runtime-lighting'
import { StackchanRuntimeUI } from 'runtime-ui'
import { type Maybe, type Pose, type Vector3, waitForCompletion } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_FACE = 1000 / 30

type RuntimeContextConstructorParam = RuntimeAudioConstructorParam &
  RuntimeCameraConstructorParam &
  RuntimeInputConstructorParam &
  RuntimeLightingConstructorParam &
  MotionControllerConstructorParam & {
    connectivity?: ConnectivityCapability
    ui: RobotUI
  }

export class StackchanRuntimeContext implements StackchanContext {
  /**
   * App-owned runtime context that delegates each capability to a focused runtime.
   */
  #audioCapability: AudioCapability
  #audioRuntime: StackchanRuntimeAudio
  #connectivityCapability: ConnectivityCapability
  #conversationCapability: ConversationCapability
  #cameraRuntime: StackchanRuntimeCamera
  #faceCapability: FaceCapability
  #inputCapability: InputCapability
  #inputRuntime: StackchanRuntimeInput
  #lifecycleCapability: LifecycleCapability
  #lightingCapability: LightingCapability
  #lightingRuntime: StackchanRuntimeLighting
  #motionCapability: MotionCapability
  #motionController: MotionController
  #paused: boolean
  #uiCapability: RuntimeUICapability
  #uiRuntime: StackchanRuntimeUI
  #updateFaceHandler: Timer | undefined
  #closed = false

  constructor(params: RuntimeContextConstructorParam) {
    this.#paused = false
    this.#motionController = new MotionController(params, {
      isPaused: () => this.#paused,
    })
    this.#uiRuntime = new StackchanRuntimeUI(params.ui, {
      getContext: () => this,
      getPose: () => this.#motionController.pose,
      getGazePoint: () => this.#motionController.gazePoint,
      isPaused: () => this.#paused,
    })
    this.#audioRuntime = new StackchanRuntimeAudio(params, {
      onMouthOpenChanged: (value) => this.#uiRuntime.setMouthOpen(value),
    })
    this.#inputRuntime = new StackchanRuntimeInput(params)
    this.#cameraRuntime = new StackchanRuntimeCamera(params)
    this.#lightingRuntime = new StackchanRuntimeLighting(params)
    this.#updateFaceHandler = Timer.repeat(this.#updateFace, INTERVAL_FACE)
    this.#faceCapability = this.createFaceCapability()
    this.#motionCapability = this.createMotionCapability()
    this.#audioCapability = this.createAudioCapability()
    this.#inputCapability = this.createInputCapability()
    this.#lifecycleCapability = this.createLifecycleCapability()
    this.#lightingCapability = this.createLightingCapability()
    this.#conversationCapability = this.createConversationCapability()
    this.#connectivityCapability = params.connectivity ?? {}
    this.#uiCapability = this.createUICapability()
  }

  get face(): FaceCapability {
    return this.#faceCapability
  }

  get motion(): MotionCapability {
    return this.#motionCapability
  }

  get audio(): AudioCapability {
    return this.#audioCapability
  }

  get input(): InputCapability {
    return this.#inputCapability
  }

  get lighting(): LightingCapability {
    return this.#lightingCapability
  }

  get conversation(): ConversationCapability {
    return this.#conversationCapability
  }

  get connectivity(): ConnectivityCapability {
    return this.#connectivityCapability
  }

  get lifecycle(): LifecycleCapability {
    return this.#lifecycleCapability
  }

  /**
   * Set a TTS instance and register callbacks.
   *
   * @param tts - TTS class instance
   */
  useTTS(tts: RuntimeAudioConstructorParam['tts']) {
    this.#audioRuntime.useTTS(tts)
  }

  /**
   * get Buttons
   *
   * @returns Button instances
   */
  get button() {
    return this.#inputRuntime.button
  }

  /**
   * get Touch
   *
   * @returns Touch instances
   */
  get touch() {
    return this.#inputRuntime.touch
  }

  /**
   * get top touch panel
   *
   * @returns TouchPanel instance
   */
  get touchPanel() {
    return this.#inputRuntime.touchPanel
  }

  /**
   * get IMU sensor
   *
   * @returns IMU instance
   */
  get imu() {
    return this.#inputRuntime.imu
  }

  /**
   * get Pose
   *
   * @returns pose instances
   */
  get pose() {
    return this.#motionController.pose
  }

  /**
   * get Microphone
   *
   * @returns Microphone instance
   */
  get microphone() {
    return this.#audioRuntime.microphone
  }

  /**
   * get Camera
   *
   * @returns Camera instance
   */
  get camera() {
    return this.#cameraRuntime.camera
  }

  /**
   * get LED
   *
   * @returns Led instances
   */
  get led() {
    return this.#lightingRuntime.led
  }

  /**
   * let the robot say things
   *
   * @param text - the key or speech text itself to say
   * @returns the text when speech finishes, otherwise the reason why it fails.
   */
  async say(text: string, volume?: number): Promise<Maybe<string>> {
    return this.#audioRuntime.say(text, volume)
  }

  async record(durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    return this.#audioRuntime.record(durationMilliSec)
  }

  /**
   * let the robot sound a tone
   * @param hz frequency of tone
   * @param duration duration (unit: millisecond)
   * @returns return when the playback of the tone is completed.
   */
  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    return this.#audioRuntime.tone(hz, duration, volume)
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    return this.#audioRuntime.playAudio(buffer)
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
    this.#motionController.lookAt(position)
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
    this.#motionController.lookAway()
  }

  /**
   * Set the pose.
   *
   * @returns void when the robot start moving
   * @experimental
   */
  async setPose(pose: Pose, time?: number): Promise<void> {
    return waitForCompletion((callback) => this.#motionController.setPose(pose, time, callback))
  }

  /**
   * Set the actuator torque.
   *
   * @returns void when the robot completes setting the torque
   */
  async setTorque(torque: boolean): Promise<void> {
    return waitForCompletion((callback) => this.#motionController.setTorque(torque, callback))
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

  get tts() {
    return this.#audioRuntime.tts
  }

  get ui(): RuntimeUICapability {
    return this.#uiCapability
  }

  get drawer() {
    return this.#uiRuntime.drawer
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
    this.#lightingRuntime.lightOn(ledName, r, g, b, duration, index, count)
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
    this.#lightingRuntime.lightOff(ledName, index, count)
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
    this.#lightingRuntime.lightBlink(ledName, r, g, b, duration, index, count)
  }

  /**
   * Displays a rainbow light effect on the specified Led.
   * @param ledName - The name of the Led to apply the rainbow effect to.
   * @param index - Optional starting index for the rainbow effect.
   * @param count - Optional number of Leds to apply the rainbow effect to.
   */
  lightRainbow(ledName: string, index?: number, count?: number) {
    this.#lightingRuntime.lightRainbow(ledName, index, count)
  }

  private createFaceCapability(): FaceCapability {
    const uiRuntime = this.#uiRuntime
    return {
      setColor(key, r, g, b) {
        uiRuntime.setColor(key, r, g, b)
      },
      setEmotion(emotion) {
        uiRuntime.setEmotion(emotion)
      },
      setMouthOpen(value) {
        uiRuntime.setMouthOpen(value)
      },
    }
  }

  private createMotionCapability(): MotionCapability {
    const motionController = this.#motionController
    return {
      get pose() {
        return motionController.pose
      },
      lookAt(position) {
        motionController.lookAt(position)
      },
      lookAway() {
        motionController.lookAway()
      },
      setPose(pose, time) {
        return waitForCompletion((callback) => motionController.setPose(pose, time, callback))
      },
      setTorque(torque) {
        return waitForCompletion((callback) => motionController.setTorque(torque, callback))
      },
    }
  }

  private createAudioCapability(): AudioCapability {
    const audioRuntime = this.#audioRuntime
    return {
      get tts() {
        return audioRuntime.tts
      },
      get microphone() {
        return audioRuntime.microphone
      },
      useTTS(tts) {
        audioRuntime.useTTS(tts)
      },
      say(text, volume) {
        return audioRuntime.say(text, volume)
      },
      record(durationMilliSec) {
        return audioRuntime.record(durationMilliSec)
      },
      tone(hz, duration, volume) {
        return audioRuntime.tone(hz, duration, volume)
      },
      playAudio(buffer) {
        return audioRuntime.playAudio(buffer)
      },
    }
  }

  private createInputCapability(): InputCapability {
    const inputRuntime = this.#inputRuntime
    return {
      get button() {
        return inputRuntime.button
      },
      get touch() {
        return inputRuntime.touch
      },
      get touchPanel() {
        return inputRuntime.touchPanel
      },
      get imu() {
        return inputRuntime.imu
      },
    }
  }

  private createLifecycleCapability(): LifecycleCapability {
    return {
      close: () => this.#close(),
    }
  }

  private createLightingCapability(): LightingCapability {
    const lightingRuntime = this.#lightingRuntime
    return {
      get led() {
        return lightingRuntime.led
      },
      lightOn(ledName, r, g, b, duration, index, count) {
        lightingRuntime.lightOn(ledName, r, g, b, duration, index, count)
      },
      lightOff(ledName, index, count) {
        lightingRuntime.lightOff(ledName, index, count)
      },
      lightBlink(ledName, r, g, b, duration, index, count) {
        lightingRuntime.lightBlink(ledName, r, g, b, duration, index, count)
      },
      lightRainbow(ledName, index, count) {
        lightingRuntime.lightRainbow(ledName, index, count)
      },
    }
  }

  private createConversationCapability(): ConversationCapability {
    const audioRuntime = this.#audioRuntime
    return {
      say(text, volume) {
        return audioRuntime.say(text, volume)
      },
    }
  }

  private createUICapability(): RuntimeUICapability {
    const uiRuntime = this.#uiRuntime
    return {
      get controller() {
        return uiRuntime.ui
      },
      update(interval, faceState) {
        uiRuntime.ui.update(interval, faceState)
      },
      addEffect(effect, key) {
        uiRuntime.ui.addEffect(effect, key)
      },
      removeEffect(effect) {
        uiRuntime.ui.removeEffect(effect)
      },
      get application() {
        return uiRuntime.ui.application
      },
      setFace(face) {
        uiRuntime.ui.setFace(face)
      },
      setMain(content) {
        uiRuntime.ui.setMain(content)
      },
      showFace() {
        uiRuntime.ui.showFace()
      },
      setDrawerButtons(buttons) {
        uiRuntime.ui.setDrawerButtons(buttons)
      },
      addDrawerButton(button) {
        uiRuntime.ui.addDrawerButton(button)
      },
      removeDrawerButton(key) {
        uiRuntime.ui.removeDrawerButton(key)
      },
      setDrawerButtonState(key, active) {
        uiRuntime.ui.setDrawerButtonState(key, active)
      },
      bindDrawerAction(key, callback) {
        return uiRuntime.ui.bindDrawerAction(key, callback)
      },
      unbindDrawerAction(key) {
        uiRuntime.ui.unbindDrawerAction(key)
      },
      openDrawer() {
        uiRuntime.ui.openDrawer()
      },
      closeDrawer() {
        uiRuntime.ui.closeDrawer()
      },
      toggleDrawer() {
        uiRuntime.ui.toggleDrawer()
      },
      get drawer() {
        return uiRuntime.drawer
      },
      showBalloon(text, option) {
        uiRuntime.showBalloon(text, option)
      },
      hideBalloon() {
        uiRuntime.hideBalloon()
      },
    }
  }

  /**
   * Update the robot face.
   * Process the robot's emotion, pose, gaze point and so on
   * to modify the face state and pass it to RobotUI#update.
   */
  #updateFace = () => {
    this.#uiRuntime.updateFace(INTERVAL_FACE)
  }

  async #close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#updateFaceHandler) {
      Timer.clear(this.#updateFaceHandler)
      this.#updateFaceHandler = undefined
    }
    this.#motionController.close()
    await this.#cameraRuntime.close()
    this.#inputRuntime.close()
    this.#audioRuntime.close()
    this.#lightingRuntime.close()
    // connectivity is owned by boot-services, not this context, so it stays open.
  }
}
