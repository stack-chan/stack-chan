import type { PreferenceConfig } from 'loadPreference'
import { createAppControllerApplication } from 'app-controller'
import { DogFace, SimpleFace, SmallFace } from 'behaviors/face'
import Camera from 'camera'
import { ChatStatusBar } from 'chat-status-bar'
import type { DrawerButtonSpec } from 'drawer'
import { DynamixelDriver } from 'dynamixel-driver'
import IMU from 'imu'
import Led from 'led'
import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import Microphone from 'microphone'
import Modules from 'modules'
import type { MotionDriver } from 'motion-controller'
import { NoneDriver } from 'none-driver'
import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import type { Container as PiuContainer } from 'piu/MC'
import PY32Led from 'py32-led'
import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import Tone from 'tone'
import { TTS as ElevenLabsTTS } from 'tts-elevenlabs'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as OpenAITTS } from 'tts-openai'
import { TTS as RemoteTTS } from 'tts-remote'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { TTS as VoiceVoxWebTTS } from 'tts-voicevox-web'
import type { RobotUI, StackchanContext, TTS } from './capabilities'
import { StackchanRuntimeContext } from './runtime-context'

type DeviceButton = {
  read: () => number
  onChanged: (this: DeviceButton) => void
}

type SimulatorButtonCtor = new (options: {
  onPush?: () => void
}) => {
  read: () => number | undefined
}

type RobotLed = Pick<Led, 'on' | 'off' | 'blink' | 'rainbow'>

type UIOptions = {
  avatar?: string
  drawerButtons?: DrawerButtonSpec[]
  displayListLength?: number
}

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'b' | 'c' | 'power', DeviceButton>>
  device?: {
    sensor?: {
      TouchPanel?: new (options: unknown) => unknown
      IMU?: new (options: unknown) => unknown
    }
  }
  Host?: {
    Button?: Partial<Record<'a' | 'b' | 'c', SimulatorButtonCtor>>
  }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment

export type HostDeviceEnvironment = GlobalEnvironment['device']

function asUIOptions(param: unknown): UIOptions {
  return (param ?? {}) as UIOptions
}

function createStackchanUI(face: PiuContainer, options: UIOptions = {}, displayListLength = 2048): RobotUI {
  return createAppControllerApplication(
    {
      face,
      appBar: new ChatStatusBar(),
      drawerButtons: options.drawerButtons,
    },
    { displayListLength },
  )
}

// wrapper button class for simulator
class SimButton {
  #button: { read: () => number | undefined }
  onChanged = () => {}
  constructor(button: SimulatorButtonCtor) {
    const self = this
    this.#button = new button({
      onPush() {
        self.onChanged()
      },
    })
  }
  read() {
    return this.#button.read() ?? 1
  }
}

export function installSimulatorButtons() {
  if (!globalEnv.Host?.Button || globalEnv.button) return
  trace('[main] installing simulator buttons\n')
  const { a, b, c } = globalEnv.Host.Button
  globalEnv.button = {
    ...(a && { a: new SimButton(a) }),
    ...(b && { b: new SimButton(b) }),
    ...(c && { c: new SimButton(c) }),
  }
}

export function getHostDeviceEnvironment(): HostDeviceEnvironment {
  return globalEnv.device
}

export function createStackchanContext(preferences: PreferenceConfig): StackchanContext {
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
  ])
  const uiControllers = new Map<string, (param: unknown) => RobotUI>([
    ['dog', (param) => createStackchanUI(new DogFace(), asUIOptions(param))],
    ['simple', (param) => createStackchanUI(new SimpleFace(), asUIOptions(param))],
    [
      'image',
      (param) => {
        const options = asUIOptions(param)
        return createStackchanUI(
          new ImageAvatarFace({ pack: options.avatar }),
          options,
          options.displayListLength ?? 4096,
        )
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

  const driver = Driver(driverPrefs)
  const ui = UI(uiPrefs)
  const tts = TTS(ttsPrefs)

  // CPU regression investigation: temporarily disable touch polling from config.Touch.
  const touch = undefined
  // CPU regression investigation: temporarily disable device.sensor.TouchPanel polling.
  const touchPanel = undefined
  const imu = globalEnv.device?.sensor?.IMU
    ? new IMU(globalEnv.device.sensor.IMU as ConstructorParameters<typeof IMU>[0])
    : undefined
  const microphone = Modules.has('embedded:io/audio/in') ? new Microphone() : undefined
  const camera = new Camera()
  const tone = new Tone({ volume: ttsPrefs.volume })

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
  const led = Object.fromEntries(ledEntries)

  return new StackchanRuntimeContext({
    driver,
    ui,
    tts,
    button: globalEnv.button,
    touch,
    touchPanel,
    imu,
    tone,
    microphone,
    camera,
    led: led as ConstructorParameters<typeof StackchanRuntimeContext>[0]['led'],
  } as ConstructorParameters<typeof StackchanRuntimeContext>[0]) as unknown as StackchanContext
}
