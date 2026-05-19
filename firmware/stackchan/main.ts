import loadPreferences from 'loadPreference'
import Camera from 'camera'
import defaultMod, { type StackchanMod } from 'default-mods/mod'
import { DynamixelDriver } from 'dynamixel-driver'
import Led from 'led'
import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import config from 'mc/config'
import Microphone from 'microphone'
import Modules from 'modules'
import { NetworkService } from 'network-service'
import { NoneDriver } from 'none-driver'
import { Renderer as DogFaceRenderer } from 'renderer-dog'
import { Renderer as ImageFaceRenderer } from 'renderer-image'
import { Renderer as SimpleRenderer } from 'renderer-simple'
import { Renderer as SmallFaceRenderer } from 'renderer-small'
import { type Driver, type Renderer, Robot, type Button as RobotButton, type TTS } from 'robot'
import PY32Led from 'py32-led'
import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import { asyncWait } from 'stackchan-util'
import Tone from 'tone'
import Touch from 'touch'
import { TTS as ElevenLabsTTS } from 'tts-elevenlabs'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as OpenAITTS } from 'tts-openai'
import { TTS as RemoteTTS } from 'tts-remote'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { TTS as VoiceVoxWebTTS } from 'tts-voicevox-web'

type DeviceButton = RobotButton & {
  read: () => number
}

type SimulatorButtonCtor = new (options: {
  onPush?: () => void
}) => {
  read: () => number | undefined
}

type RobotLed = Pick<Led, 'on' | 'off' | 'blink' | 'rainbow'>

type GlobalEnvironment = {
  button?: Partial<Record<'a' | 'b' | 'c', DeviceButton>>
  network?: NetworkService
  device?: unknown
  Host?: {
    Button?: Partial<Record<'a' | 'b' | 'c', SimulatorButtonCtor>>
  }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return value != null && typeof (value as { then?: unknown }).then === 'function'
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

function createRobot() {
  const drivers = new Map<string, (param: unknown) => Driver>([
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
  const renderers = new Map<string, (param: unknown) => Renderer>([
    ['dog', (param) => new DogFaceRenderer(param as ConstructorParameters<typeof DogFaceRenderer>[0])],
    ['simple', (param) => new SimpleRenderer(param as ConstructorParameters<typeof SimpleRenderer>[0])],
    ['image', (param) => new ImageFaceRenderer(param as ConstructorParameters<typeof ImageFaceRenderer>[0])],
    ['small-face', (param) => new SmallFaceRenderer(param as ConstructorParameters<typeof SmallFaceRenderer>[0])],
  ])

  const errors: string[] = []

  // Servo Driver
  const driverPrefs = loadPreferences('driver')
  const driverKey = driverPrefs.type ?? 'scservo'
  const Driver = drivers.get(driverKey)

  // TTS
  const ttsPrefs = loadPreferences('tts')
  const ttsKey = ttsPrefs.type ?? 'local'
  const TTS = ttsEngines.get(ttsKey)

  // Renderer
  const rendererPrefs = loadPreferences('renderer')
  const rendererKey = rendererPrefs.type ?? 'simple'
  const Renderer = renderers.get(rendererKey)

  if (!Driver || !TTS || !Renderer) {
    for (const [key, klass] of [
      [driverKey, Driver],
      [ttsKey, TTS],
      [rendererKey, Renderer],
    ]) {
      if (klass == null) {
        errors.push(`type "${key}" does not exist`)
      }
    }
    throw new Error(errors.join('\n'))
  }

  const driver = Driver(driverPrefs)
  const renderer = Renderer(rendererPrefs)
  const tts = TTS(ttsPrefs)

  const touch = config.Touch ? new Touch(config.Touch) : undefined
  const microphone = Modules.has('embedded:io/audio/in') ? new Microphone() : undefined
  const camera = new Camera()
  const tone = new Tone({ volume: ttsPrefs.volume })

  const configLed = loadPreferences('led')
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

  return new Robot({
    driver,
    renderer,
    tts,
    button: globalEnv.button,
    touch,
    tone,
    microphone,
    camera,
    led: led as ConstructorParameters<typeof Robot>[0]['led'],
  } as ConstructorParameters<typeof Robot>[0])
}

async function checkAndConnectWiFi() {
  const wifiPrefs = loadPreferences('wifi')
  if (wifiPrefs.ssid == null || wifiPrefs.password == null) {
    return
  }
  return new Promise<void>((resolve, reject) => {
    globalEnv.network = new NetworkService({
      ssid: wifiPrefs.ssid,
      password: wifiPrefs.password,
    })
    globalEnv.network.connect(resolve, reject)
  })
}

async function main() {
  trace(`[main] start wasm=${Boolean(config.wasm)}\n`)
  if (globalEnv.Host?.Button && !globalEnv.button) {
    trace('[main] installing simulator buttons\n')
    const { a, b, c } = globalEnv.Host.Button
    globalEnv.button = {
      ...(a && { a: new SimButton(a) }),
      ...(b && { b: new SimButton(b) }),
      ...(c && { c: new SimButton(c) }),
    }
  }
  if (config.wasm) {
    trace('[main] wasm path start\n')
    const wasmDefaultMod = Modules.importNow('default-mods/wasm/mod') as StackchanMod
    let { onRobotCreated, onLaunch } = wasmDefaultMod
    trace(`[main] wasm defaultMod onLaunch=${onLaunch != null} onRobotCreated=${onRobotCreated != null}\n`)
    if (Modules.has('mod')) {
      trace('[main] wasm loading mod override\n')
      const mod = Modules.importNow('mod') as StackchanMod
      onRobotCreated = mod.onRobotCreated ?? onRobotCreated
      onLaunch = mod.onLaunch ?? onLaunch
    }
    const launchResult = onLaunch?.() ?? true
    const continueWasm = (shouldRobotCreate: boolean) => {
      trace(`[main] wasm onLaunch shouldRobotCreate=${shouldRobotCreate}\n`)
      if (shouldRobotCreate) {
        const robot = createRobot()
        trace('[main] wasm robot created\n')
        const robotCreatedResult = onRobotCreated?.(robot, globalEnv.device)
        if (isThenable(robotCreatedResult)) {
          robotCreatedResult
            .then(() => {
              trace('[main] wasm onRobotCreated complete\n')
            })
            .catch((error) => {
              trace(`[main] wasm onRobotCreated error ${error?.message ?? error}\n`)
            })
        } else {
          trace('[main] wasm onRobotCreated complete\n')
        }
      }
      trace('[main] wasm path complete\n')
    }
    if (isThenable(launchResult)) {
      launchResult.then(continueWasm).catch((error) => {
        trace(`[main] wasm onLaunch error ${error?.message ?? error}\n`)
      })
    } else {
      continueWasm(launchResult)
    }
    return
  }
  await asyncWait(100)
  trace('[main] check Wi-Fi start\n')
  await checkAndConnectWiFi().catch((msg) => {
    trace(`WiFi connection failed: ${msg}`)
  })
  trace('[main] check Wi-Fi complete\n')
  trace('[main] loading default mod\n')
  let { onRobotCreated, onLaunch } = defaultMod
  trace('[main] checking mod override\n')
  if (Modules.has('mod')) {
    const mod = Modules.importNow('mod') as StackchanMod
    onRobotCreated = mod.onRobotCreated ?? onRobotCreated
    onLaunch = mod.onLaunch ?? onLaunch
  }
  const shouldRobotCreate = await (onLaunch?.() ?? true)
  trace(`[main] onLaunch shouldRobotCreate=${shouldRobotCreate}\n`)
  if (shouldRobotCreate) {
    const robot = createRobot()
    trace('[main] robot created\n')
    await onRobotCreated?.(robot, globalEnv.device)
    trace('[main] onRobotCreated complete\n')
  }
}

main().catch((error) => {
  trace(`[main] error ${error?.message ?? error}\n`)
})
