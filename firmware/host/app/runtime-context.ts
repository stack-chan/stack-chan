import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type {
  AudioCapability,
  ConnectivityCapability,
  ConversationCapability,
  FaceCapability,
  I18nCapability,
  InputCapability,
  InteractionCapability,
  LifecycleCapability,
  LightingCapability,
  MotionCapability,
  RobotUI,
  RuntimeUICapability,
  ShowBalloonOptions,
  StackchanContext,
  UIEffect,
} from 'capabilities'
import type { BehaviorDefinition } from 'character-profile'
import { Emoticon } from 'effects/emoticon'
import type { Emotion, FaceEyeKey, FaceThemeKey } from 'face-state'
import type { BehaviorFrame } from 'interaction-types'
import { LocalPeerError, type LocalPeerSession } from 'local-peer-types'
import { createI18nCapability } from 'localization'
import { MotionController, type MotionControllerConstructorParam } from 'motion-controller'
import { type RuntimeAudioConstructorParam, StackchanRuntimeAudio } from 'runtime-audio'
import { type RuntimeCameraConstructorParam, StackchanRuntimeCamera } from 'runtime-camera'
import { type RuntimeInputConstructorParam, StackchanRuntimeInput } from 'runtime-input'
import { emotionForExpression, RuntimeInteraction } from 'runtime-interaction'
import {
  type ManualLightingCommand,
  type RuntimeLightingConstructorParam,
  StackchanRuntimeLighting,
} from 'runtime-lighting'
import { StackchanRuntimeUI } from 'runtime-ui'
import { type Maybe, type Pose, type Rotation, type Vector3, waitForCompletion } from 'stackchan-util'
import Time from 'time'
import Timer from 'timer'

const INTERVAL_FACE = 1000 / 30
const INTERVAL_INTERACTION = 1000 / 20

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
  #i18nCapability: I18nCapability
  #inputCapability: InputCapability
  #inputRuntime: StackchanRuntimeInput
  #interactionCapability: InteractionCapability
  #interactionEffect: UIEffect | null = null
  #interactionEffectKey: string | null = null
  #interactionEffectOpacityStep = -1
  #interactionLedCapturedCommand: ManualLightingCommand | undefined
  #interactionLedLastAt = -Infinity
  #interactionLedLastB = -1
  #interactionLedLastG = -1
  #interactionLedLastR = -1
  #interactionLedLease = false
  #interactionLedName: string | undefined
  #interactionNow = 0
  #interactionRawTicks: number | undefined
  #interactionMotionBase: Rotation | null = null
  #interactionMotionGaze: Vector3 | null = null
  #interactionMotionLastAt = -Infinity
  #interactionMotionLease = false
  #interactionMotionPose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0, p: 0, r: 0 },
  }
  #interactionMotionReturnTimer: ReturnType<typeof Timer.set> | undefined
  #interactionRuntime: RuntimeInteraction
  #lifecycleCapability: LifecycleCapability
  #lightingCapability: LightingCapability
  #lightingRuntime: StackchanRuntimeLighting
  #localPeerSessions = new Set<LocalPeerSession>()
  #motionCapability: MotionCapability
  #motionController: MotionController
  #paused: boolean
  #uiCapability: RuntimeUICapability
  #uiRuntime: StackchanRuntimeUI
  #updateFaceHandler: Timer | undefined
  #closed = false

  constructor(params: RuntimeContextConstructorParam) {
    this.#paused = false
    const initialTicks = Time.ticks
    if (Number.isFinite(initialTicks)) this.#interactionRawTicks = initialTicks
    this.#motionController = new MotionController(params, {
      isPaused: () => this.#paused,
    })
    this.#uiRuntime = new StackchanRuntimeUI(params.ui, {
      getContext: () => this,
      getPose: () => this.#motionController.pose,
      getGazePoint: () => this.#motionController.gazePoint,
      isPaused: () => this.#paused,
    })
    this.#interactionRuntime = new RuntimeInteraction({
      now: () => this.#interactionNow,
      random: () => Math.random(),
      frameIntervalMs: INTERVAL_INTERACTION,
      applyFrame: this.#applyInteractionFrame,
      applyLegacyEmotion: (emotion) => this.#uiRuntime.setEmotion(emotion),
    })
    this.#audioRuntime = new StackchanRuntimeAudio(params, {
      onMouthOpenChanged: (value) => this.setMouthOpen(value),
    })
    this.#inputRuntime = new StackchanRuntimeInput(params)
    this.#cameraRuntime = new StackchanRuntimeCamera(params)
    this.#lightingRuntime = new StackchanRuntimeLighting(params, { now: () => this.#interactionNow })
    this.#updateFaceHandler = Timer.repeat(this.#updateFace, INTERVAL_FACE)
    void this.#updateFaceHandler
    this.#interactionCapability = this.createInteractionCapability()
    this.#faceCapability = this.createFaceCapability()
    this.#motionCapability = this.createMotionCapability()
    this.#audioCapability = this.createAudioCapability()
    // Capture the host-owned localization service after boot selected a locale;
    // MODs receive this stable boundary instead of importing host UI internals.
    this.#i18nCapability = createI18nCapability()
    this.#inputCapability = this.createInputCapability()
    this.#lifecycleCapability = this.createLifecycleCapability()
    this.#lightingCapability = this.createLightingCapability()
    this.#conversationCapability = this.createConversationCapability()
    this.#connectivityCapability = this.createConnectivityCapability(params.connectivity ?? {})
    this.#uiCapability = this.createUICapability()
  }

  get face(): FaceCapability {
    return this.#faceCapability
  }

  get interaction(): InteractionCapability {
    return this.#interactionCapability
  }

  get motion(): MotionCapability {
    return this.#motionCapability
  }

  get audio(): AudioCapability {
    return this.#audioCapability
  }

  get i18n(): I18nCapability {
    return this.#i18nCapability
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

  /**
   * Sing raw stackchan-voice koe notation when the active TTS supports it.
   *
   * @param koe - romanized koe notation with `#` note annotations
   * @returns the koe notation when singing finishes, otherwise the reason why it fails.
   */
  async sing(koe: string, volume?: number): Promise<Maybe<string>> {
    return this.#audioRuntime.sing(koe, volume)
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
    this.#prepareManualMotion()
    this.#motionController.lookAt(position)
  }

  /**
   * Show balloon decorator
   *
   * @param text - the text on the balloon
   */
  showBalloon(text: string, option: ShowBalloonOptions = {}) {
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
    this.#prepareManualMotion()
    this.#motionController.lookAway()
  }

  /**
   * Set the pose.
   *
   * @returns void when the robot start moving
   * @experimental
   */
  async setPose(pose: Pose, time?: number): Promise<void> {
    this.#prepareManualMotion()
    return waitForCompletion((callback) => this.#motionController.setPose(pose, time, callback))
  }

  /**
   * Set the actuator torque.
   *
   * @returns void when the robot completes setting the torque
   */
  async setTorque(torque: boolean): Promise<void> {
    this.#prepareManualMotion()
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
    this.#interactionRuntime.setBaseEmotion(emotion)
  }

  setEyeOpen(key: FaceEyeKey, value: number) {
    this.#uiRuntime.setEyeOpen(key, value)
  }

  setMouthOpen(value: number) {
    if (!this.#interactionRuntime.installed) {
      this.#uiRuntime.setMouthOpen(value)
      return
    }
    this.#uiRuntime.setMouthOpen(0)
    this.#interactionRuntime.setSignal({ type: 'speech-envelope', value })
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
    this.#prepareManualLighting(ledName)
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
    this.#prepareManualLighting(ledName)
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
    this.#prepareManualLighting(ledName)
    this.#lightingRuntime.lightBlink(ledName, r, g, b, duration, index, count)
  }

  /**
   * Displays a rainbow light effect on the specified Led.
   * @param ledName - The name of the Led to apply the rainbow effect to.
   * @param index - Optional starting index for the rainbow effect.
   * @param count - Optional number of Leds to apply the rainbow effect to.
   */
  lightRainbow(ledName: string, index?: number, count?: number) {
    this.#prepareManualLighting(ledName)
    this.#lightingRuntime.lightRainbow(ledName, index, count)
  }

  private createFaceCapability(): FaceCapability {
    return {
      setColor: (key, r, g, b) => this.setColor(key, r, g, b),
      setEmotion: (emotion) => this.setEmotion(emotion),
      setEyeOpen: (key, value) => this.setEyeOpen(key, value),
      setMouthOpen: (value) => this.setMouthOpen(value),
    }
  }

  private createInteractionCapability(): InteractionCapability {
    return {
      install: (definition: BehaviorDefinition) => {
        this.#configureInteractionOutputs(definition)
        this.#interactionRuntime.install(definition)
      },
      dispatch: (input) => this.#interactionRuntime.dispatch(input),
      setSignal: (signal) => this.#interactionRuntime.setSignal(signal),
    }
  }

  private createMotionCapability(): MotionCapability {
    const context = this
    return {
      get pose() {
        return context.pose
      },
      lookAt(position) {
        context.lookAt(position)
      },
      lookAway() {
        context.lookAway()
      },
      setPose(pose, time) {
        return context.setPose(pose, time)
      },
      setTorque(torque) {
        return context.setTorque(torque)
      },
    }
  }

  private createAudioCapability(): AudioCapability {
    const context = this
    return {
      get tts() {
        return context.tts
      },
      get microphone() {
        return context.microphone
      },
      useTTS(tts) {
        context.useTTS(tts)
      },
      say(text, volume) {
        return context.say(text, volume)
      },
      sing(koe, volume) {
        return context.sing(koe, volume)
      },
      record(durationMilliSec) {
        return context.record(durationMilliSec)
      },
      tone(hz, duration, volume) {
        return context.tone(hz, duration, volume)
      },
      playAudio(buffer) {
        return context.playAudio(buffer)
      },
      get webRadio() {
        return context.#audioRuntime.webRadio
      },
    }
  }

  private createInputCapability(): InputCapability {
    const context = this
    return {
      get button() {
        return context.button
      },
      get touch() {
        return context.touch
      },
      get touchPanel() {
        return context.touchPanel
      },
      get imu() {
        return context.imu
      },
    }
  }

  private createLifecycleCapability(): LifecycleCapability {
    return {
      close: () => this.#close(),
    }
  }

  private createLightingCapability(): LightingCapability {
    const context = this
    return {
      get led() {
        return context.led
      },
      lightOn(ledName, r, g, b, duration, index, count) {
        context.lightOn(ledName, r, g, b, duration, index, count)
      },
      lightOff(ledName, index, count) {
        context.lightOff(ledName, index, count)
      },
      lightBlink(ledName, r, g, b, duration, index, count) {
        context.lightBlink(ledName, r, g, b, duration, index, count)
      },
      lightRainbow(ledName, index, count) {
        context.lightRainbow(ledName, index, count)
      },
    }
  }

  private createConversationCapability(): ConversationCapability {
    return {
      say: (text, volume) => this.say(text, volume),
    }
  }

  private createConnectivityCapability(connectivity: ConnectivityCapability): ConnectivityCapability {
    const localPeer = connectivity.localPeer
    if (!localPeer) return connectivity
    const context = this
    return {
      ...connectivity,
      localPeer: {
        get id() {
          return localPeer.id
        },
        async open(options) {
          if (context.#closed) throw new LocalPeerError('closed', 'Stack-chan context is closed')
          const session = await localPeer.open(options)
          if (context.#closed) {
            session.close()
            throw new LocalPeerError('closed', 'Stack-chan context is closed')
          }
          const trackedSession: LocalPeerSession = {
            discover: (discoverOptions) => session.discover(discoverOptions),
            send: (peerId, type, payload) => session.send(peerId, type, payload),
            broadcast: (type, payload) => session.broadcast(type, payload),
            subscribe: (type, handler) => session.subscribe(type, handler),
            close() {
              if (!context.#localPeerSessions.delete(trackedSession)) return
              session.close()
            },
          }
          context.#localPeerSessions.add(trackedSession)
          return trackedSession
        },
      },
    }
  }

  private createUICapability(): RuntimeUICapability {
    const context = this
    return {
      get controller() {
        return context.#uiRuntime.ui
      },
      get miniApps() {
        return context.#uiRuntime.ui.miniApps
      },
      update(interval, faceState) {
        context.#uiRuntime.ui.update(interval, faceState)
      },
      addEffect(effect, key) {
        context.#uiRuntime.ui.addEffect(effect, key)
      },
      removeEffect(effect) {
        context.#uiRuntime.ui.removeEffect(effect)
      },
      get application() {
        return context.#uiRuntime.ui.application
      },
      setFace(face) {
        context.#uiRuntime.ui.setFace(face)
      },
      setHandAnimation(animation) {
        context.#uiRuntime.ui.setHandAnimation(animation)
      },
      setFaceMotionEnabled(enabled) {
        context.#uiRuntime.ui.setFaceMotionEnabled?.(enabled)
      },
      setMain(content) {
        context.#uiRuntime.ui.setMain(content)
      },
      showFace() {
        context.#uiRuntime.ui.showFace()
      },
      setDrawerButtons(buttons) {
        context.#uiRuntime.ui.setDrawerButtons(buttons)
      },
      addDrawerButton(button) {
        context.#uiRuntime.ui.addDrawerButton(button)
      },
      removeDrawerButton(key) {
        context.#uiRuntime.ui.removeDrawerButton(key)
      },
      setDrawerButtonState(key, active) {
        context.#uiRuntime.ui.setDrawerButtonState(key, active)
      },
      bindDrawerAction(key, callback) {
        return context.#uiRuntime.ui.bindDrawerAction(key, callback)
      },
      unbindDrawerAction(key) {
        context.#uiRuntime.ui.unbindDrawerAction(key)
      },
      openDrawer() {
        context.#uiRuntime.ui.openDrawer()
      },
      closeDrawer() {
        context.#uiRuntime.ui.closeDrawer()
      },
      toggleDrawer() {
        context.#uiRuntime.ui.toggleDrawer()
      },
      get drawer() {
        return context.drawer
      },
      showBalloon(text, option) {
        context.showBalloon(text, option)
      },
      hideBalloon() {
        context.hideBalloon()
      },
    }
  }

  #configureInteractionOutputs(definition: BehaviorDefinition): void {
    const requestedLedName = definition.profile.output.ledName
    if (requestedLedName !== undefined) {
      if (this.#lightingRuntime.led[requestedLedName]) {
        this.#interactionLedName = requestedLedName
      } else {
        this.#interactionLedName = undefined
        trace(`[Interaction] configured LED is unavailable: ${requestedLedName}\n`)
      }
      return
    }
    this.#interactionLedName = Object.keys(this.#lightingRuntime.led)[0]
  }

  #applyInteractionFrame = (frame: BehaviorFrame): void => {
    this.#uiRuntime.applyBehaviorFrame(frame, emotionForExpression(frame.expression))
    this.#applyInteractionEffect(frame)
    this.#applyInteractionMotion(frame)
    this.#applyInteractionLighting(frame)
  }

  #applyInteractionEffect(frame: BehaviorFrame): void {
    const key = frame.effect.key
    const opacityStep = Math.max(0, Math.min(16, Math.round(frame.effect.opacity * 16)))
    if (!key || opacityStep === 0) {
      if (this.#interactionEffect) this.#uiRuntime.ui.removeEffect(this.#interactionEffect)
      this.#interactionEffect = null
      this.#interactionEffectKey = null
      this.#interactionEffectOpacityStep = -1
      return
    }
    if (!this.#interactionEffect || key !== this.#interactionEffectKey) {
      if (this.#interactionEffect) this.#uiRuntime.ui.removeEffect(this.#interactionEffect)
      this.#interactionEffect = new Emoticon({
        key,
        name: 'interaction-emotion',
        opacity: opacityStep / 16,
      })
      this.#interactionEffectKey = key
      this.#interactionEffectOpacityStep = opacityStep
      this.#uiRuntime.ui.addEffect(this.#interactionEffect, 'emotion')
      return
    }
    if (opacityStep === this.#interactionEffectOpacityStep) return
    this.#interactionEffectOpacityStep = opacityStep
    ;(
      this.#interactionEffect as UIEffect & {
        distribute?: (event: string, value: number) => void
      }
    ).distribute?.('onEffectOpacity', opacityStep / 16)
  }

  #applyInteractionMotion(frame: BehaviorFrame): void {
    const profile = this.#interactionRuntime.profile
    if (!profile) return
    if (!frame.motion.active) {
      if (this.#interactionMotionLease) this.#finishInteractionMotion()
      return
    }
    if (!this.#interactionMotionLease) this.#beginInteractionMotion()
    if (!this.#interactionMotionBase || frame.at - this.#interactionMotionLastAt < profile.motion.updateIntervalMs)
      return
    this.#interactionMotionLastAt = frame.at
    const target = this.#interactionMotionPose.rotation
    target.y = this.#interactionMotionBase.y + frame.motion.yaw
    target.p = this.#interactionMotionBase.p + frame.motion.pitch
    target.r = this.#interactionMotionBase.r + frame.motion.roll
    try {
      this.#motionController.setPose(this.#interactionMotionPose, profile.motion.updateIntervalMs / 1000, (error) => {
        if (error) this.#handleInteractionMotionError(error)
      })
    } catch (error) {
      this.#handleInteractionMotionError(error)
    }
  }

  #beginInteractionMotion(): void {
    if (this.#interactionMotionReturnTimer) {
      Timer.clear(this.#interactionMotionReturnTimer)
      this.#interactionMotionReturnTimer = undefined
    }
    const pose = this.#motionController.pose.body
    this.#interactionMotionBase = { ...pose.rotation }
    this.#interactionMotionPose.position.x = pose.position.x
    this.#interactionMotionPose.position.y = pose.position.y
    this.#interactionMotionPose.position.z = pose.position.z
    const gaze = this.#motionController.gazePoint
    this.#interactionMotionGaze = gaze ? [gaze[0], gaze[1], gaze[2]] : null
    this.#motionController.lookAway()
    this.#interactionMotionLease = true
    this.#interactionMotionLastAt = -Infinity
    try {
      this.#motionController.setTorque(true, (error) => {
        if (error) this.#handleInteractionMotionError(error)
      })
    } catch (error) {
      this.#handleInteractionMotionError(error)
    }
  }

  #finishInteractionMotion(): void {
    const profile = this.#interactionRuntime.profile
    const base = this.#interactionMotionBase
    const gaze = this.#interactionMotionGaze
    this.#interactionMotionLease = false
    this.#interactionMotionBase = null
    this.#interactionMotionGaze = null
    this.#interactionMotionLastAt = -Infinity
    if (!profile || !base) return
    const target = this.#interactionMotionPose.rotation
    target.y = base.y
    target.p = base.p
    target.r = base.r
    try {
      this.#motionController.setPose(this.#interactionMotionPose, profile.motion.returnMs / 1000, (error) => {
        if (error) trace(`[Interaction] motion restore failed: ${String(error)}\n`)
      })
    } catch (error) {
      trace(`[Interaction] motion restore failed: ${String(error)}\n`)
    }
    if (this.#interactionMotionReturnTimer) Timer.clear(this.#interactionMotionReturnTimer)
    this.#interactionMotionReturnTimer = Timer.set(() => {
      this.#interactionMotionReturnTimer = undefined
      try {
        this.#motionController.setTorque(false, (error) => {
          if (error) trace(`[Interaction] torque release failed: ${String(error)}\n`)
        })
      } catch (error) {
        trace(`[Interaction] torque release failed: ${String(error)}\n`)
      }
      if (gaze) this.#motionController.lookAt(gaze)
    }, profile.motion.returnMs + 50)
  }

  #handleInteractionMotionError(error: unknown): void {
    trace(`[Interaction] motion output failed: ${String(error)}\n`)
    this.#abandonInteractionMotion()
    try {
      this.#motionController.setTorque(false, (releaseError) => {
        if (releaseError) trace(`[Interaction] torque release failed: ${String(releaseError)}\n`)
      })
    } catch (releaseError) {
      trace(`[Interaction] torque release failed: ${String(releaseError)}\n`)
    }
    this.#interactionRuntime.cancelActionsUsing('motion', 'output-error')
  }

  #abandonInteractionMotion(): void {
    if (this.#interactionMotionReturnTimer) {
      Timer.clear(this.#interactionMotionReturnTimer)
      this.#interactionMotionReturnTimer = undefined
    }
    this.#interactionMotionLease = false
    this.#interactionMotionBase = null
    this.#interactionMotionGaze = null
    this.#interactionMotionLastAt = -Infinity
  }

  #prepareManualMotion(): void {
    if (!this.#interactionMotionLease && !this.#interactionMotionReturnTimer) return
    const actionWasActive = this.#interactionMotionLease
    this.#abandonInteractionMotion()
    if (actionWasActive) this.#interactionRuntime.cancelActionsUsing('motion')
  }

  #applyInteractionLighting(frame: BehaviorFrame): void {
    const profile = this.#interactionRuntime.profile
    const ledName = this.#interactionLedName
    if (!profile || !ledName) return
    if (!frame.lighting.active) {
      this.#restoreInteractionLighting()
      return
    }
    if (!this.#interactionLedLease) {
      this.#interactionLedCapturedCommand = this.#lightingRuntime.snapshotManualCommand(ledName)
      this.#interactionLedLease = true
      this.#interactionLedLastAt = -Infinity
      this.#interactionLedLastR = -1
      this.#interactionLedLastG = -1
      this.#interactionLedLastB = -1
    }
    if (frame.at - this.#interactionLedLastAt < profile.output.lightingUpdateIntervalMs) return
    const r = Math.max(0, Math.min(255, Math.round(frame.lighting.r * 255)))
    const g = Math.max(0, Math.min(255, Math.round(frame.lighting.g * 255)))
    const b = Math.max(0, Math.min(255, Math.round(frame.lighting.b * 255)))
    if (r === this.#interactionLedLastR && g === this.#interactionLedLastG && b === this.#interactionLedLastB) return
    this.#interactionLedLastAt = frame.at
    this.#interactionLedLastR = r
    this.#interactionLedLastG = g
    this.#interactionLedLastB = b
    this.#lightingRuntime.applyInteractionColor(ledName, r, g, b)
  }

  #restoreInteractionLighting(): void {
    const ledName = this.#interactionLedName
    if (!this.#interactionLedLease || !ledName) return
    this.#interactionLedLease = false
    this.#lightingRuntime.restoreManualCommand(ledName, this.#interactionLedCapturedCommand)
    this.#interactionLedCapturedCommand = undefined
    this.#interactionLedLastAt = -Infinity
    this.#interactionLedLastR = -1
    this.#interactionLedLastG = -1
    this.#interactionLedLastB = -1
  }

  #prepareManualLighting(ledName: string): void {
    if (!this.#interactionLedLease || ledName !== this.#interactionLedName) return
    this.#interactionRuntime.cancelActionsUsing('lighting')
  }

  #releaseInteractionOutputs(): void {
    if (this.#interactionEffect) {
      this.#uiRuntime.ui.removeEffect(this.#interactionEffect)
      this.#interactionEffect = null
    }
    this.#restoreInteractionLighting()
    const ownedMotion = this.#interactionMotionLease || this.#interactionMotionReturnTimer !== undefined
    if (ownedMotion) {
      this.#abandonInteractionMotion()
      try {
        this.#motionController.setTorque(false)
      } catch (error) {
        trace(`[Interaction] close torque release failed: ${String(error)}\n`)
      }
    }
  }

  #advanceInteractionClock(): void {
    // Device ticks roll over and the WASM Time binding has no counter.
    // Accumulate rollover-safe deltas when available and use the host tick
    // cadence as the simulator fallback.
    const ticks = Time.ticks
    let elapsed = INTERVAL_FACE
    if (Number.isFinite(ticks)) {
      if (this.#interactionRawTicks !== undefined) {
        const measured = Time.delta(this.#interactionRawTicks, ticks)
        if (Number.isFinite(measured) && measured >= 0) elapsed = measured
      }
      this.#interactionRawTicks = ticks
    }
    this.#interactionNow += elapsed
  }

  /**
   * Update the robot face.
   * Process the robot's emotion, pose, gaze point and so on
   * to modify the face state and pass it to RobotUI#update.
   */
  #updateFace = () => {
    this.#advanceInteractionClock()
    try {
      this.#interactionRuntime.tick()
    } catch (error) {
      trace(`[Interaction] tick failed: ${String(error)}\n`)
    }
    this.#uiRuntime.updateFace(INTERVAL_FACE)
  }

  async #close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#updateFaceHandler) {
      Timer.clear(this.#updateFaceHandler)
      this.#updateFaceHandler = undefined
    }
    this.#releaseInteractionOutputs()
    this.#motionController.close()
    let closeError: unknown
    let hasCloseError = false
    const rememberCloseError = (error: unknown) => {
      if (hasCloseError) return
      closeError = error
      hasCloseError = true
    }
    for (const session of this.#localPeerSessions) {
      try {
        session.close()
      } catch (error) {
        rememberCloseError(error)
      }
    }
    this.#localPeerSessions.clear()
    try {
      await this.#cameraRuntime.close()
    } catch (error) {
      rememberCloseError(error)
    } finally {
      for (const closeRuntime of [
        () => this.#inputRuntime.close(),
        () => this.#audioRuntime.close(),
        () => this.#lightingRuntime.close(),
      ]) {
        try {
          closeRuntime()
        } catch (error) {
          rememberCloseError(error)
        }
      }
    }
    if (hasCloseError) throw closeError
    // connectivity is owned by boot-services, not this context, so it stays open.
  }
}
