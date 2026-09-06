import type { PreferenceConfig } from 'loadPreference'
import { createAppControllerApplication } from 'app-controller'
import { DogFace, SimpleFace, SmallFace } from 'behaviors/face'
import Camera from 'camera'
import type {
  ConnectivityCapability,
  RemoteConversationSession,
  RobotLed,
  RobotUI,
  TTS,
  WebRadioCapability,
} from 'capabilities'
import { type BatteryLevelReader, ChatStatusBar } from 'chat-status-bar'
import type { DrawerButtonViewSpec } from 'drawer'
import { DynamixelDriver } from 'dynamixel-driver'
import IMU from 'imu'
import Led from 'led'
import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import config from 'mc/config'
import Microphone from 'microphone'
import Modules from 'modules'
import type { MotionDriver } from 'motion-controller'
import { NoneDriver } from 'none-driver'
import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import type { Container as PiuContainer } from 'piu/MC'
import PY32Led from 'py32-led'
import { RS30XDriver } from 'rs30x-driver'
import { StackchanRuntimeContext } from 'runtime-context'
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
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import Speaker from 'speaker'
import Touch, { type TouchOptions } from 'touch'
import TouchPanel from 'touch-panel'
import { TTS as ElevenLabsTTS } from 'tts-elevenlabs'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as OpenAITTS } from 'tts-openai'
import { TTS as RemoteTTS } from 'tts-remote'
import { TTS as StackchanVoiceTTS } from 'tts-stackchan-voice'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { TTS as VoiceVoxWebTTS } from 'tts-voicevox-web'

type DeviceButton = {
  read: () => number
  onChanged: (this: DeviceButton) => void
}

type UIOptions = {
  avatar?: string
  drawerButtons?: DrawerButtonViewSpec[]
  displayListLength?: number
}

export type StackchanContextOptions = {
  connectivity?: ConnectivityCapability
  remoteConversationSession?: RemoteConversationSession
  closeHandlers?: ReadonlyArray<() => void | Promise<void>>
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'b' | 'c' | 'power', DeviceButton>>
  device?: {
    sensor?: {
      IMU?: new (options: unknown) => unknown
      TouchPanel?: ConstructorParameters<typeof TouchPanel>[0]
    }
  }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment

export type HostDeviceEnvironment = GlobalEnvironment['device']

type WebRadioPlayerConstructor = new () => WebRadioCapability

const DEFAULT_UI_DISPLAY_LIST_LENGTH = 4096

function asUIOptions(param: unknown): UIOptions {
  return (param ?? {}) as UIOptions
}

function loadBatteryLevelReader(): BatteryLevelReader | undefined {
  if (!Modules.has('battery-status')) return undefined
  try {
    return Modules.importNow('battery-status') as BatteryLevelReader
  } catch (error) {
    trace(`[ui] battery status unavailable: ${String(error)}\n`)
    return undefined
  }
}

function createStackchanUI(face: PiuContainer, options: UIOptions = {}): RobotUI {
  return createAppControllerApplication(
    {
      face,
      appBar: new ChatStatusBar({ readBatteryLevel: loadBatteryLevelReader() }),
      drawerButtons: options.drawerButtons,
    },
    { displayListLength: options.displayListLength ?? DEFAULT_UI_DISPLAY_LIST_LENGTH },
  )
}

function configNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function createTouchOptions(): TouchOptions {
  return {
    count: configNumber(config.touchCount),
    intervalMs: configNumber(config.touchIntervalMs),
    idleIntervalMs: configNumber(config.touchIdleIntervalMs),
    activeIntervalMs: configNumber(config.touchActiveIntervalMs),
    releaseDebounceMs: configNumber(config.touchReleaseDebounceMs),
  }
}

export function getHostDeviceEnvironment(): HostDeviceEnvironment {
  return globalEnv.device
}

export async function createStackchanContext(
  preferences: PreferenceConfig,
  options: StackchanContextOptions = {},
): Promise<StackchanRuntimeContext> {
  // Unwind the boot caller before entering Piu's deep synchronous construction.
  // Keep the same bounded XS stack on devices and in the browser simulator.
  await Promise.resolve()
  const drivers = new Map<string, (param: unknown) => MotionDriver>([
    ['scservo', (param) => new SCServoDriver(param as ConstructorParameters<typeof SCServoDriver>[0])],
    [
      'm5stackchan',
      (param) => new M5StackChanServoDriver(param as ConstructorParameters<typeof M5StackChanServoDriver>[0]),
    ],
    ['dynamixel', (param) => new DynamixelDriver(param as ConstructorParameters<typeof DynamixelDriver>[0])],
    ['pwm', (param) => new PWMServoDriver(param as ConstructorParameters<typeof PWMServoDriver>[0])],
    ['rs30x', (param) => new RS30XDriver(param as ConstructorParameters<typeof RS30XDriver>[0])],
    ['none', () => new NoneDriver()],
  ])
  const ttsEngines = new Map<string, (param: unknown) => TTS>([
    ['local', (param) => new LocalTTS(param as ConstructorParameters<typeof LocalTTS>[0])],
    ['remote', (param) => new RemoteTTS(param as ConstructorParameters<typeof RemoteTTS>[0])],
    ['voicevox', (param) => new VoiceVoxTTS(param as ConstructorParameters<typeof VoiceVoxTTS>[0])],
    ['voicevox-web', (param) => new VoiceVoxWebTTS(param as ConstructorParameters<typeof VoiceVoxWebTTS>[0])],
    ['elevenlabs', (param) => new ElevenLabsTTS(param as ConstructorParameters<typeof ElevenLabsTTS>[0])],
    ['openai', (param) => new OpenAITTS(param as ConstructorParameters<typeof OpenAITTS>[0])],
    ['stackchan-voice', (param) => new StackchanVoiceTTS(param as ConstructorParameters<typeof StackchanVoiceTTS>[0])],
  ])
  const faces = new Map<string, (param: UIOptions) => PiuContainer>([
    ['dog', () => new DogFace()],
    ['simple', () => new SimpleFace()],
    ['image', (options) => new ImageAvatarFace({ pack: options.avatar })],
    ['small-face', () => new SmallFace()],
  ])

  const errors: string[] = []

  // Servo Driver
  const driverPrefs = preferences.driver
  const driverKey = driverPrefs.type ?? 'scservo'
  const Driver = drivers.get(driverKey)

  // TTS
  const ttsPrefs = preferences.tts
  const ttsKey = ttsPrefs.type ?? 'local'
  const TTS = ttsEngines.get(ttsKey)

  // UI
  const uiPrefs = preferences.ui
  const uiKey = uiPrefs.type ?? 'simple'
  const Face = faces.get(uiKey)

  if (!Driver || !TTS || !Face) {
    for (const [key, klass] of [
      [driverKey, Driver],
      [ttsKey, TTS],
      [uiKey, Face],
    ]) {
      if (klass == null) {
        errors.push(`type "${key}" does not exist`)
      }
    }
    throw new Error(errors.join('\n'))
  }

  trace(`[main] TTS engine: ${ttsKey}\n`)

  const resources = new RuntimeResources()
  try {
    const driver = ownMotionDriver(resources.motion, Driver(driverPrefs))
    const uiOptions = asUIOptions(uiPrefs)
    const ui = ownUI(resources.ui, createStackchanUI(Face(uiOptions), uiOptions))
    const tts = ownTTS(resources.audio, TTS(ttsPrefs))

    const touch = config.Touch ? resources.input.own(new Touch(config.Touch, createTouchOptions())) : undefined
    const touchPanelConstructor = (config.TouchPanel ?? globalEnv.device?.sensor?.TouchPanel) as
      | ConstructorParameters<typeof TouchPanel>[0]
      | undefined
    if (touchPanelConstructor && !config.TouchPanel) {
      trace('[main] using device.sensor.TouchPanel fallback\n')
    }
    const touchPanel = touchPanelConstructor ? resources.input.own(new TouchPanel(touchPanelConstructor)) : undefined
    const imu = globalEnv.device?.sensor?.IMU
      ? resources.input.own(new IMU(globalEnv.device.sensor.IMU as ConstructorParameters<typeof IMU>[0]))
      : undefined
    const microphone = Modules.has('audio-in') ? ownMicrophone(resources.audio, new Microphone()) : undefined
    const camera = ownCamera(resources.camera, new Camera())
    const speaker = resources.audio.own(new Speaker({ volume: ttsPrefs.volume }))
    const webRadio = Modules.has('web-radio-player')
      ? ownWebRadio(resources.audio, new (Modules.importNow('web-radio-player') as WebRadioPlayerConstructor)())
      : undefined

    const configLed = preferences.led
    const ledEntries: [string, RobotLed][] = Object.entries(configLed).flatMap(
      ([key, ledConfig]): [string, RobotLed][] => {
        const candidate = ledConfig as {
          type?: unknown
          pin?: unknown
          length?: unknown
          order?: unknown
          ledPin?: unknown
          address?: unknown
        }
        if (
          typeof ledConfig !== 'object' ||
          ledConfig == null ||
          (candidate.length !== undefined && typeof candidate.length !== 'number') ||
          (candidate.order !== undefined && typeof candidate.order !== 'string') ||
          (candidate.ledPin !== undefined && typeof candidate.ledPin !== 'number') ||
          (candidate.address !== undefined && typeof candidate.address !== 'number')
        ) {
          trace(`[main] skip led config (invalid shape): ${key}\n`)
          return []
        }
        if (candidate.type === 'py32') {
          if (typeof candidate.ledPin !== 'number') {
            trace(`[main] skip py32 led config (missing/invalid ledPin): ${key}\n`)
            return []
          }
          const light = new PY32Led(candidate as { length?: number; ledPin?: number; address?: number })
          if (!light.available) {
            light.close()
            return []
          }
          return [[key, ownLed(resources.lighting, light)]]
        }
        if (typeof candidate.pin !== 'number') {
          trace(`[main] skip led config (missing/invalid pin): ${key}\n`)
          return []
        }
        return [
          [key, ownLed(resources.lighting, new Led(candidate as { pin: number; length?: number; order?: string }))],
        ]
      },
    )
    const led: Record<string, RobotLed> = {}
    for (const [key, value] of ledEntries) {
      led[key] = value
    }

    const contextParams = {
      driver,
      ui,
      restoreFace: () => ui.setFace(Face(uiOptions)),
      tts,
      ttsKind:
        config.wasm && ttsKey !== 'stackchan-voice'
          ? ('unavailable' as const)
          : ttsKey === 'local'
            ? ('clips' as const)
            : ('speech' as const),
      clipPlayer: config.wasm ? undefined : ttsKey === 'local' ? tts : ownTTS(resources.audio, new LocalTTS(ttsPrefs)),
      simulated: !!config.wasm,
      button: globalEnv.button,
      touch,
      touchPanel,
      imu,
      connectivity: options.connectivity,
      remoteConversationSession: options.remoteConversationSession,
      closeHandlers: options.closeHandlers,
      speaker,
      webRadio,
      microphone,
      camera,
      led,
    } satisfies Parameters<typeof StackchanRuntimeContext.create>[0]
    return await StackchanRuntimeContext.create(contextParams, resources)
  } catch (error) {
    try {
      await resources.close()
    } catch (cleanupError) {
      trace(`[compose] initialization cleanup failed: ${String(cleanupError)}\n`)
    }
    throw error
  }
}
