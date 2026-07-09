import type { PreferenceConfig } from 'loadPreference'
import Camera from 'camera'
import type { ConnectivityCapability, RobotLed, StackchanContext } from 'capabilities'
import IMU from 'imu'
import Led from 'led'
import config from 'mc/config'
import Microphone from 'microphone'
import Modules from 'modules'
import PY32Led from 'py32-led'
import { StackchanRuntimeContext } from 'runtime-context'
import Speaker from 'speaker'
import { getMotionDriverFactory, getTTSFactory, getUIFactory } from 'stackchan-factory-registry'
import Touch, { type TouchOptions } from 'touch'
import TouchPanel from 'touch-panel'

type DeviceButton = {
  read: () => number
  onChanged: (this: DeviceButton) => void
}

type SimulatorButtonCtor = new (options: {
  onPush?: () => void
}) => {
  read: () => number | undefined
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
  Host?: {
    Button?: Partial<Record<'a' | 'b' | 'c', SimulatorButtonCtor>>
  }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment

export type HostDeviceEnvironment = GlobalEnvironment['device']

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

export function createStackchanContext(
  preferences: PreferenceConfig,
  options: StackchanContextOptions = {},
): StackchanContext {
  const errors: string[] = []

  // Servo Driver
  const driverPrefs = preferences.driver
  const driverKey = driverPrefs.type ?? 'scservo'
  const Driver = getMotionDriverFactory(driverKey)

  // TTS
  const ttsPrefs = preferences.tts
  const ttsKey = ttsPrefs.type ?? 'local'
  const TTS = getTTSFactory(ttsKey)

  // UI
  const uiPrefs = preferences.ui
  const uiKey = uiPrefs.type ?? 'simple'
  const UI = getUIFactory(uiKey)

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
    microphone,
    camera,
    led,
  } satisfies ConstructorParameters<typeof StackchanRuntimeContext>[0]
  const context: StackchanContext = new StackchanRuntimeContext(contextParams)
  return context
}
