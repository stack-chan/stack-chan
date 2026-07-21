import type { PreferenceConfig } from 'loadPreference'
import { createAppControllerApplication } from 'app-controller'
import { DogFace, SimpleFace, SmallFace } from 'behaviors/face'
import Camera from 'camera'
import type { ConnectivityCapability, RobotLed, RobotUI, StackchanContext, TTS, WebRadioCapability } from 'capabilities'
import { ChatStatusBar } from 'chat-status-bar'
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

function createStackchanUI(face: PiuContainer, options: UIOptions = {}): RobotUI {
  return createAppControllerApplication(
    {
      face,
      appBar: new ChatStatusBar(),
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

export function createStackchanContext(
  preferences: PreferenceConfig,
  options: StackchanContextOptions = {},
): StackchanContext {
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
  const uiControllers = new Map<string, (param: unknown) => RobotUI>([
    ['dog', (param) => createStackchanUI(new DogFace(), asUIOptions(param))],
    ['simple', (param) => createStackchanUI(new SimpleFace(), asUIOptions(param))],
    [
      'image',
      (param) => {
        const options = asUIOptions(param)
        return createStackchanUI(new ImageAvatarFace({ pack: options.avatar }), options)
      },
    ],
    ['small-face', (param) => createStackchanUI(new SmallFace(), asUIOptions(param))],
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
  const UI = uiControllers.get(uiKey)

  if (!Driver || !TTS || !UI) {
    for (const [key, klass] of [
      [driverKey, Driver],
      [ttsKey, TTS],
      [uiKey, UI],
    ]) {
      if (klass == null) {
        errors.push(`type "${key}" does not exist`)
      }
    }
    throw new Error(errors.join('\n'))
  }

  trace(`[main] TTS engine: ${ttsKey}\n`)

  const driver = Driver(driverPrefs)
  const ui = UI(uiPrefs)
  const tts = TTS(ttsPrefs)

  const touch = config.Touch ? new Touch(config.Touch, createTouchOptions()) : undefined
  const touchPanelConstructor = (config.TouchPanel ?? globalEnv.device?.sensor?.TouchPanel) as
    | ConstructorParameters<typeof TouchPanel>[0]
    | undefined
  if (touchPanelConstructor && !config.TouchPanel) {
    trace('[main] using device.sensor.TouchPanel fallback\n')
  }
  const touchPanel = touchPanelConstructor ? new TouchPanel(touchPanelConstructor) : undefined
  const imu = globalEnv.device?.sensor?.IMU
    ? new IMU(globalEnv.device.sensor.IMU as ConstructorParameters<typeof IMU>[0])
    : undefined
  const microphone = Modules.has('audio-in') ? new Microphone() : undefined
  const camera = new Camera()
  const speaker = new Speaker({ volume: ttsPrefs.volume })
  const webRadio = Modules.has('web-radio-player')
    ? new (Modules.importNow('web-radio-player') as WebRadioPlayerConstructor)()
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
        return [[key, new PY32Led(candidate as { length?: number; ledPin?: number; address?: number })]]
      }
      if (typeof candidate.pin !== 'number') {
        trace(`[main] skip led config (missing/invalid pin): ${key}\n`)
        return []
      }
      return [[key, new Led(candidate as { pin: number; length?: number; order?: string })]]
    },
  )
  const led: Record<string, RobotLed> = {}
  for (const [key, value] of ledEntries) {
    led[key] = value
  }

  const contextParams = {
    driver,
    ui,
    tts,
    button: globalEnv.button,
    touch,
    touchPanel,
    imu,
    connectivity: options.connectivity,
    speaker,
    webRadio,
    microphone,
    camera,
    led,
  } satisfies ConstructorParameters<typeof StackchanRuntimeContext>[0]
  const context: StackchanContext = new StackchanRuntimeContext(contextParams)
  return context
}
