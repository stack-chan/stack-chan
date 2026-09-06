import { AppSession } from 'app-session'
import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type {
  AudioCapability,
  ConnectivityCapability,
  ConversationCapability,
  FaceCapability,
  I18nCapability,
  InputCapability,
  LifecycleCapability,
  LightingCapability,
  MotionCapability,
  RemoteConversationSession,
  RobotUI,
  RuntimeUICapability,
  ShowBalloonOptions,
  StackchanContext,
} from 'capabilities'
import clockTicks from 'clock-ticks'
import { Emotion, type FaceEyeKey, type FaceThemeKey } from 'face-state'
import { LocalPeerError, type LocalPeerSession } from 'local-peer-types'
import { createI18nCapability } from 'localization'
import { MotionController, type MotionControllerConstructorParam } from 'motion-controller'
import { OwnedResources } from 'owned-resources'
import { type RuntimeAudioConstructorParam, StackchanRuntimeAudio } from 'runtime-audio'
import { type RuntimeCameraConstructorParam, StackchanRuntimeCamera } from 'runtime-camera'
import { type RuntimeInputConstructorParam, StackchanRuntimeInput } from 'runtime-input'
import { type RuntimeLightingConstructorParam, StackchanRuntimeLighting } from 'runtime-lighting'
import { StackchanRuntimeMotion } from 'runtime-motion'
import {
  ownCamera,
  ownLed,
  ownMicrophone,
  ownMotionDriver,
  ownTTS,
  ownUI,
  ownWebRadio,
  RuntimeResources,
} from 'runtime-resources'
import { StackchanRuntimeUI } from 'runtime-ui'
import type { AppDefinition } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import { type Maybe, type Pose, type Vector3, waitForCompletion } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_FACE = 1000 / 30

type RuntimeContextConstructorParam = RuntimeAudioConstructorParam &
  RuntimeCameraConstructorParam &
  RuntimeInputConstructorParam &
  RuntimeLightingConstructorParam &
  MotionControllerConstructorParam & {
    connectivity?: ConnectivityCapability
    remoteConversationSession?: RemoteConversationSession
    closeHandlers?: ReadonlyArray<() => void | Promise<void>>
    ui: RobotUI
    restoreFace?: () => void
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
  #lifecycleCapability: LifecycleCapability
  #lightingRuntime: StackchanRuntimeLighting
  #localPeerSessions = new Set<LocalPeerSession>()
  #motionCapability: MotionCapability
  #motionController: MotionController
  #appMotion: StackchanRuntimeMotion | undefined
  #paused: boolean
  #uiCapability: RuntimeUICapability
  #uiRuntime: StackchanRuntimeUI
  #updateFaceHandler: Timer | undefined
  #closed = false
  #simulated: boolean
  #devices: RuntimeResources
  #ownedResources: OwnedResources
  #shutdown: OwnedResources | undefined
  #appSession: AppSession | undefined

  private constructor(params: RuntimeContextConstructorParam, devices: RuntimeResources) {
    this.#ownedResources = new OwnedResources(params.closeHandlers)
    this.#devices = devices
    this.#paused = false
    this.#simulated = !!params.simulated
  }

  /** Construction has one asynchronous completion, including rollback on error. */
  static async create(
    params: RuntimeContextConstructorParam,
    devices?: RuntimeResources,
  ): Promise<StackchanRuntimeContext> {
    const context = new StackchanRuntimeContext(params, devices ?? new RuntimeResources())
    try {
      if (!devices) context.#ownDevices(params)
      context.#initialize(params)
      return context
    } catch (error) {
      try {
        await context.#close()
      } catch (cleanupError) {
        trace(`[context] initialization cleanup failed: ${String(cleanupError)}\n`)
      }
      throw error
    }
  }

  #ownDevices(params: RuntimeContextConstructorParam): void {
    const devices = this.#devices
    ownUI(devices.ui, params.ui)
    ownMotionDriver(devices.motion, params.driver)
    ownTTS(devices.audio, params.tts)
    if (params.clipPlayer && params.clipPlayer !== params.tts) ownTTS(devices.audio, params.clipPlayer)
    if (params.microphone) ownMicrophone(devices.audio, params.microphone)
    if (params.speaker) devices.audio.defer(() => params.speaker.close?.())
    if (params.webRadio) ownWebRadio(devices.audio, params.webRadio)
    for (const sensor of [params.touch, params.touchPanel, params.imu]) {
      if (sensor) devices.input.own(sensor)
    }
    if (params.camera) ownCamera(devices.camera, params.camera)
    for (const led of Object.values(params.led ?? {})) ownLed(devices.lighting, led)
  }

  #initialize(params: RuntimeContextConstructorParam): void {
    this.#motionController = new MotionController(params, {
      isPaused: () => this.#paused,
    })
    this.#uiRuntime = new StackchanRuntimeUI(
      params.ui,
      {
        restoreFace: params.restoreFace,
        getContext: () => this,
        getPose: () => this.#motionController.pose,
        getGazePoint: () => (this.#appMotion ? this.#appMotion.gazePoint : this.#motionController.gazePoint),
        isPaused: () => this.#paused,
      },
      this.#devices.ui,
    )
    this.#audioRuntime = new StackchanRuntimeAudio(
      params,
      {
        onMouthOpenChanged: (value) => this.#uiRuntime.setMouthOpen(value),
      },
      this.#devices.audio,
    )
    this.#inputRuntime = new StackchanRuntimeInput(params, this.#devices.input)
    this.#cameraRuntime = new StackchanRuntimeCamera(params, this.#devices.camera)
    this.#lightingRuntime = new StackchanRuntimeLighting(params, this.#devices.lighting)
    this.#updateFaceHandler = Timer.repeat(this.#updateFace, INTERVAL_FACE)
    void this.#updateFaceHandler
    this.#faceCapability = this.createFaceCapability()
    this.#motionCapability = this.createMotionCapability()
    this.#audioCapability = this.createAudioCapability()
    // Capture the host-owned localization service after boot selected a locale;
    // MODs receive this stable boundary instead of importing host UI internals.
    this.#i18nCapability = createI18nCapability()
    this.#inputCapability = this.createInputCapability()
    this.#lifecycleCapability = this.createLifecycleCapability()
    this.#conversationCapability = this.createConversationCapability(params.remoteConversationSession)
    this.#connectivityCapability = this.createConnectivityCapability(params.connectivity ?? {})
    this.#uiCapability = this.createUICapability()
  }

  async startApp(definition: AppDefinition): Promise<AppSession> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Host context is closed')
    if (this.#appSession && this.#appSession.state !== 'closed')
      throw new StackchanError('BUSY', 'An app is already running')
    // API generations do not share a live gaze/torque controller. V2 takes
    // sole ownership of motion scheduling; the host keeps the raw driver.
    const driver = this.#motionController.driver
    this.#motionController.close()
    const motion = new StackchanRuntimeMotion(driver, {
      clock: {
        now: clockTicks,
        after(ms, callback) {
          let active = true
          const timer = Timer.set(() => {
            if (!active) return
            active = false
            callback()
          }, ms)
          return () => {
            if (active) {
              active = false
              Timer.clear(timer)
            }
          }
        },
      },
      onPosition: (rotation) => {
        const body = this.#motionController.pose.body.rotation
        body.y = rotation.y
        body.p = rotation.p
        body.r = rotation.r
      },
      onError: (error) => trace(`[app] ${error.code}: ${error.message}\n`),
    })
    this.#appMotion = motion
    const emotions = {
      neutral: Emotion.NEUTRAL,
      happy: Emotion.HAPPY,
      angry: Emotion.ANGRY,
      sad: Emotion.SAD,
      sleepy: Emotion.SLEEPY,
      doubt: Emotion.DOUBTFUL,
      cold: Emotion.COLD,
      hot: Emotion.HOT,
    }
    const primaryListeners = new Set<() => void>()
    const primaryKey = 'sdkPrimaryAction'
    const uiRuntime = this.#uiRuntime
    // WASM has no light output bridge; its legacy stub is not a simulated device.
    const lightNames = Object.freeze(this.#simulated ? [] : Object.keys(this.#lightingRuntime.led))
    const session = new AppSession(
      {
        controls: {
          get faceStyle() {
            return uiRuntime.faceStyle
          },
          setFaceStyle: (style) => this.#uiRuntime.setFaceStyle(style),
          setHandAnimation: (animation) => this.#uiRuntime.setHandAnimation(animation),
          setEmoticon: (emoticon) => this.#uiRuntime.setEmoticon(emoticon),
          localize: (key, parameters) => this.#i18nCapability.localize(key, parameters),
          closeMenu: () => this.#uiRuntime.ui.closeDrawer(),
          resetAppearance: () => this.#uiRuntime.resetAppearance(),
          registerMenu: (view, onSelect) => {
            const ui = this.#uiRuntime.ui
            const key = `sdk:menu:${view.id}`
            const update = (value?: string | boolean) => {
              ui.addDrawerButton({
                key,
                label: view.label,
                kind: view.kind,
                value: typeof value === 'string' ? value : undefined,
                options: view.options ? [...view.options] : undefined,
              })
              if (typeof value === 'boolean') ui.setDrawerButtonState(key, value)
            }
            try {
              if (!ui.bindDrawerAction(key, onSelect)) throw new StackchanError('UNSUPPORTED', 'Menus are unavailable')
              update(view.value)
            } catch (error) {
              try {
                ui.unbindDrawerAction(key)
              } finally {
                ui.removeDrawerButton(key)
              }
              throw error
            }
            return {
              setValue: update,
              close: () => {
                try {
                  ui.unbindDrawerAction(key)
                } finally {
                  ui.removeDrawerButton(key)
                }
              },
            }
          },
        },
        registerScreen: (definition) => this.#uiRuntime.ui.miniApps.register(definition),
        motion,
        camera: this.#cameraRuntime.createCaptureSession({
          after(ms, callback) {
            const timer = Timer.set(callback, ms)
            return () => Timer.clear(timer)
          },
        }),
        face: {
          setEmotion: (emotion) => {
            if (!Object.hasOwn(emotions, emotion)) throw new StackchanError('INVALID_ARGUMENT', 'Unknown emotion')
            this.setEmotion(emotions[emotion])
          },
          setMouthOpen: (value) => this.setMouthOpen(value),
          setColor: (part, { r, g, b }) => {
            if (part !== 'primary' && part !== 'secondary')
              throw new StackchanError('INVALID_ARGUMENT', 'Unknown face color')
            this.setColor(part, r, g, b)
          },
        },
        audio: this.#audioRuntime.createAppSession(),
        lighting: {
          names: lightNames,
          color: (name, { r, g, b }) => this.#lightingRuntime.lightOn(name, r, g, b),
          blink: (name, { r, g, b }, { periodMs }) => this.#lightingRuntime.lightBlink(name, r, g, b, periodMs),
          rainbow: (name) => this.#lightingRuntime.lightRainbow(name),
          off: (name) => this.#lightingRuntime.lightOff(name),
        },
        input: {
          subscribeHeadTouch: (handler) => this.#inputRuntime.subscribeHeadTouch(handler),
          subscribeMotion: (handler) => this.#inputRuntime.subscribeMotion(handler),
          subscribePress: (handler, name = 'primary') => {
            if (name !== 'primary' || this.#inputRuntime.primaryButton)
              return this.#inputRuntime.subscribePress(handler, name)
            const ui = this.#uiRuntime.ui
            if (primaryListeners.size === 0) {
              if (
                !ui.bindDrawerAction(primaryKey, () => {
                  for (const listener of [...primaryListeners]) listener()
                })
              ) {
                throw new StackchanError('UNSUPPORTED', 'Primary action is unavailable')
              }
              try {
                ui.addDrawerButton({ key: primaryKey, label: '実行', kind: 'action', icon: 'play' })
              } catch (error) {
                ui.unbindDrawerAction(primaryKey)
                throw error
              }
            }
            primaryListeners.add(handler)
            return () => {
              primaryListeners.delete(handler)
              if (primaryListeners.size === 0) {
                ui.unbindDrawerAction(primaryKey)
                ui.removeDrawerButton(primaryKey)
              }
            }
          },
        },
        ui: {
          showBalloon: (text) => this.showBalloon(text),
          hideBalloon: () => this.hideBalloon(),
          showImage: (image) => this.#uiRuntime.showImage(image),
          hideImage: () => this.#uiRuntime.hideImage(),
        },
        capabilities: {
          get: (id) => {
            const present = (available: boolean) =>
              available
                ? { availability: this.#simulated ? ('simulated' as const) : ('native' as const) }
                : { availability: 'unavailable' as const, reason: `${id} is unavailable on this device` }
            switch (id) {
              case 'motion':
                return motion.info
              case 'camera':
                return this.#cameraRuntime.info
              case 'input.primary':
              case 'ui.piu':
              case 'ui.controls':
                return present(true)
              case 'input.secondary':
                return present(!!this.#inputRuntime.buttonFor('secondary'))
              case 'input.tertiary':
                return present(!!this.#inputRuntime.buttonFor('tertiary'))
              case 'input.headTouch':
                return present(!!this.#inputRuntime.touchPanel)
              case 'input.motion':
                return present(!!this.#inputRuntime.imu)
              case 'lighting':
                return present(lightNames.length > 0)
              case 'audio.speech':
                return this.#audioRuntime.audioStatus('speech')
              case 'audio.clips':
                return this.#audioRuntime.audioStatus('clips')
              case 'audio.tone':
                return this.#audioRuntime.audioStatus('tone')
              case 'audio.recording':
                return this.#audioRuntime.audioStatus('recording')
              case 'audio.playback':
                return this.#audioRuntime.audioStatus('playback')
              default:
                throw new StackchanError('INVALID_ARGUMENT', 'Unknown capability')
            }
          },
        },
      },
      {
        after(ms, callback) {
          const timer = Timer.set(callback, ms)
          return () => Timer.clear(timer)
        },
      },
      (error) => trace(`[app] ${error instanceof Error ? error.message : String(error)}\n`),
    )
    this.#appSession = session
    await session.start(definition)
    return session
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

  get i18n(): I18nCapability {
    return this.#i18nCapability
  }

  get input(): InputCapability {
    return this.#inputCapability
  }

  get lighting(): LightingCapability {
    return this.#lightingRuntime
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

  setEyeOpen(key: FaceEyeKey, value: number) {
    this.#uiRuntime.setEyeOpen(key, value)
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

  private createFaceCapability(): FaceCapability {
    return {
      setColor: (key, r, g, b) => this.setColor(key, r, g, b),
      setEmotion: (emotion) => this.setEmotion(emotion),
      setEyeOpen: (key, value) => this.setEyeOpen(key, value),
      setMouthOpen: (value) => this.setMouthOpen(value),
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

  private createConversationCapability(remoteSession?: RemoteConversationSession): ConversationCapability {
    return {
      say: (text, volume) => this.say(text, volume),
      ...(remoteSession ? { remoteSession } : {}),
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

  /**
   * Update the robot face.
   * Process the robot's emotion, pose, gaze point and so on
   * to modify the face state and pass it to RobotUI#update.
   */
  #updateFace = () => {
    if (this.#closed) return
    this.#uiRuntime.updateFace(INTERVAL_FACE)
  }

  #close(): Promise<void> {
    if (!this.#shutdown) {
      this.#closed = true
      this.#shutdown = new OwnedResources([
        () => {
          if (this.#updateFaceHandler) Timer.clear(this.#updateFaceHandler)
          this.#updateFaceHandler = undefined
        },
        () => this.#appSession?.close(),
        () => this.#appMotion?.close(),
        () => this.#motionController?.close(),
        () => this.#devices.motion.close(),
        () => this.#ownedResources.close(),
        () =>
          new OwnedResources([...this.#localPeerSessions].map((session) => () => session.close()))
            .close()
            .finally(() => this.#localPeerSessions.clear()),
        () => this.#cameraRuntime?.close(),
        () => this.#inputRuntime?.close(),
        () => this.#audioRuntime?.close(),
        () => this.#lightingRuntime?.close(),
        () => this.#uiRuntime?.close(),
        () => this.#devices.close(),
      ])
    }
    return this.#shutdown.close()
  }
}
