import { createAppExtensions } from 'app-extensions'
import { AppSession } from 'app-session'
import type { AudioStreamAccess } from 'audio-ports'
import type { ConnectivityCapability, HostPresentation, RemoteConversationSession, RobotUI } from 'capabilities'
import clockTicks from 'clock-ticks'
import type { Emotion } from 'face-state'
import { localizeApp } from 'localization'
import Modules from 'modules'
import type { MotionDriver } from 'motion-driver'
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
import { type RuntimeUIPose, StackchanRuntimeUI } from 'runtime-ui'
import { type AppDefinition, type CapabilityId, type CapabilityStatus, EMOTIONS } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import Timer from 'timer'

const INTERVAL_FACE = 1000 / 30

type RuntimeContextConstructorParam = RuntimeAudioConstructorParam &
  RuntimeCameraConstructorParam &
  RuntimeInputConstructorParam &
  RuntimeLightingConstructorParam & {
    driver: MotionDriver
    pose?: RuntimeUIPose
    connectivity?: ConnectivityCapability
    remoteConversationSession?: RemoteConversationSession
    closeHandlers?: ReadonlyArray<() => void | Promise<void>>
    ui: RobotUI
    restoreFace?: () => void
  }

export class StackchanRuntimeContext {
  /**
   * Host-owned runtime context that delegates each capability to a focused runtime.
   */
  #driver: MotionDriver
  #pose: RuntimeUIPose
  #remoteSession: RemoteConversationSession | undefined
  #audioRuntime: StackchanRuntimeAudio
  #connectivityCapability: ConnectivityCapability
  #cameraRuntime: StackchanRuntimeCamera
  #inputRuntime: StackchanRuntimeInput
  #lightingRuntime: StackchanRuntimeLighting
  #appMotion: StackchanRuntimeMotion | undefined
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
        await context.close()
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
    this.#driver = params.driver
    this.#pose = params.pose ?? {
      body: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
      eyes: {
        left: { position: { x: 0.03, y: 0.009, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
        right: { position: { x: 0.03, y: -0.009, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
      },
    }
    this.#uiRuntime = new StackchanRuntimeUI(
      params.ui,
      {
        restoreFace: params.restoreFace,
        getPose: () => this.#pose,
        getGazePoint: () => this.#appMotion?.gazePoint,
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
    this.#remoteSession = params.remoteConversationSession
    this.#connectivityCapability = params.connectivity ?? {}
  }

  async startApp(definition: AppDefinition): Promise<AppSession> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Host context is closed')
    if (this.#appSession && this.#appSession.state !== 'closed')
      throw new StackchanError('BUSY', 'An app is already running')
    const driver = this.#driver
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
        const body = this.#pose.body.rotation
        body.y = rotation.y
        body.p = rotation.p
        body.r = rotation.r
      },
      onError: (error) => trace(`[app] ${error.code}: ${error.message}\n`),
    })
    this.#appMotion = motion
    const primaryListeners = new Set<() => void>()
    const primaryKey = 'sdkPrimaryAction'
    const uiRuntime = this.#uiRuntime
    // WASM has no light output bridge; its legacy stub is not a simulated device.
    const lightNames = Object.freeze(this.#simulated ? [] : Object.keys(this.#lightingRuntime.led))
    const session = new AppSession(
      {
        extensions: (scope) =>
          createAppExtensions(scope, {
            audio: this.#audioRuntime,
            connectivity: this.#connectivityCapability,
            remote: this.#remoteSession,
            maintenance: driver.maintenance,
            maintain: (operation, resume) => motion.maintain(operation, resume),
          }),
        controls: {
          get faceStyle() {
            return uiRuntime.faceStyle
          },
          setFaceStyle: (style) => this.#uiRuntime.setFaceStyle(style),
          setShapeFace: (face) => this.#uiRuntime.setShapeFace(face),
          openMenu: () => this.#uiRuntime.ui.openDrawer(),
          toggleMenu: () => this.#uiRuntime.ui.toggleDrawer(),
          showFace: () => this.#uiRuntime.ui.showFace(),
          setImageAvatar: (pack) => this.#uiRuntime.setImageAvatar(pack),
          setHandAnimation: (animation) => this.#uiRuntime.setHandAnimation(animation),
          setEmoticon: (emoticon) => this.#uiRuntime.setEmoticon(emoticon),
          localize: (key, parameters) => localizeApp(key, parameters),
          closeMenu: () => this.#uiRuntime.ui.closeDrawer(),
          resetAppearance: () => this.#uiRuntime.resetAppearance(),
          setTracking: (value) => this.#uiRuntime.setTracking(value),
          setMusicNotes: (enabled) => this.#uiRuntime.setMusicNotes(enabled),
          setFaceMotionEnabled: (enabled) => this.#uiRuntime.setFaceMotionEnabled(enabled),
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
            const value = EMOTIONS.indexOf(emotion)
            if (value < 0) throw new StackchanError('INVALID_ARGUMENT', 'Unknown emotion')
            this.#uiRuntime.setEmotion(value as Emotion)
          },
          setMouthOpen: (value) => this.#uiRuntime.setMouthOpen(value),
          setColor: (part, { r, g, b }) => {
            if (part !== 'primary' && part !== 'secondary')
              throw new StackchanError('INVALID_ARGUMENT', 'Unknown face color')
            this.#uiRuntime.setColor(part, r, g, b)
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
          subscribeRelease: (handler, name) => this.#inputRuntime.subscribeRelease(handler, name),
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
          showBalloon: (text) => this.#uiRuntime.showBalloon(text),
          hideBalloon: () => this.#uiRuntime.hideBalloon(),
          showImage: (image) => this.#uiRuntime.showImage(image),
          hideImage: () => this.#uiRuntime.hideImage(),
        },
        capabilities: { get: (id) => this.getCapability(id) },
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

  /** The same live status is used by boot preflight and by the running SDK app. */
  getCapability(id: CapabilityId): CapabilityStatus {
    if (this.#closed) return { availability: 'unavailable', reason: 'Host context is closed' }
    const present = (available: boolean): CapabilityStatus =>
      available
        ? { availability: this.#simulated ? 'simulated' : 'native' }
        : { availability: 'unavailable', reason: `${id} is unavailable on this device` }
    const network = (
      globalThis as {
        device?: {
          network?: {
            http?: { client?: { io?: unknown } }
            https?: { client?: { io?: unknown } }
          }
        }
      }
    ).device?.network
    switch (id) {
      case 'face':
      case 'settings':
        return present(true)
      case 'network.peer':
        return present(!!this.#connectivityCapability.localPeer)
      case 'network.http':
        return present(Modules.has('app-http') && !!(network?.http?.client?.io || network?.https?.client?.io))
      case 'conversation.dialogue':
        return present(Modules.has('app-http') && !!network?.https?.client?.io)
      case 'network.ble':
        return present(!this.#simulated && Modules.has('bleserver'))
      case 'network.dnssd':
        return present(
          !!(globalThis as { device?: { network?: { dnssd?: { io?: unknown } } } }).device?.network?.dnssd?.io,
        )
      case 'conversation.realtime':
        return present(!this.#simulated && Modules.has('chat'))
      case 'conversation.remote':
        return present(!!this.#remoteSession)
      case 'audio.monitor':
        return present(!!this.#audioRuntime.microphone?.monitor && this.#audioRuntime.microphone.available !== false)
      case 'audio.radio':
        return present(!!this.#audioRuntime.streamingRadio)
      case 'sensors.temperature':
        return present(
          !!(globalThis as { device?: { I2C?: { default?: object } } }).device?.I2C?.default &&
            Modules.has('embedded:sensor/Humidity-Temperature/SHT3x'),
        )
      case 'motion.maintenance':
        return present(!!this.#driver.maintenance)
      case 'motion':
        return this.#appMotion?.info ?? this.#driver.motion?.info ?? present(false)
      case 'camera':
        return this.#cameraRuntime.info
      case 'input.primary':
      case 'ui.piu':
      case 'ui.controls':
        return present(true)
      case 'input.primary.release':
        return present(!!this.#inputRuntime.primaryButton)
      case 'input.secondary.release':
      case 'input.secondary':
        return present(!!this.#inputRuntime.buttonFor('secondary'))
      case 'input.tertiary.release':
      case 'input.tertiary':
        return present(!!this.#inputRuntime.buttonFor('tertiary'))
      case 'input.headTouch':
        return present(!!this.#inputRuntime.touchPanel)
      case 'input.motion':
        return present(!!this.#inputRuntime.imu)
      case 'lighting':
        return present(!this.#simulated && Object.keys(this.#lightingRuntime.led).length > 0)
      case 'audio.singing':
        return this.#audioRuntime.audioStatus('singing')
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
      default: {
        const unknown: never = id
        throw new StackchanError('INVALID_ARGUMENT', `Unknown capability: ${unknown}`)
      }
    }
  }

  /** The Dock borrows these host operations; SDK apps receive only AppSession.context. */
  get audioAccess(): AudioStreamAccess {
    return this.#audioRuntime
  }

  get presentation(): HostPresentation {
    return { ui: this.#uiRuntime.ui, setMouthOpen: (value) => this.#uiRuntime.setMouthOpen(value) }
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

  close(): Promise<void> {
    if (!this.#shutdown) {
      this.#closed = true
      this.#shutdown = new OwnedResources([
        () => {
          if (this.#updateFaceHandler) Timer.clear(this.#updateFaceHandler)
          this.#updateFaceHandler = undefined
        },
        () => this.#appSession?.close(),
        () => this.#appMotion?.close(),
        () => this.#devices.motion.close(),
        () => this.#ownedResources.close(),
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
