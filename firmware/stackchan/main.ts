import Modules from 'modules'
import { Robot, type Driver, type TTS, type Renderer } from 'robot'
import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import { DynamixelDriver } from 'dynamixel-driver'
import { NoneDriver } from 'none-driver'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as RemoteTTS } from 'tts-remote'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { TTS as VoiceVoxWebTTS } from 'tts-voicevox-web'
import { TTS as ElevenLabsTTS } from 'tts-elevenlabs'
import { TTS as OpenAITTS } from 'tts-openai'
import defaultMod, { type StackchanMod } from 'default-mods/mod'
import { Renderer as SimpleRenderer } from 'renderer-simple'
import { Renderer as DogFaceRenderer } from 'renderer-dog'
import { Renderer as SmallFaceRenderer } from 'renderer-small'
import { NetworkService } from 'network-service'
import Microphone from 'microphone'
import Tone from 'tone'
import { asyncWait } from 'stackchan-util'
import loadPreferences from 'loadPreference'
import Led from 'led'

// wrapper button class for simulator
class SimButton {
  #button
  onChanged
  constructor(button) {
    const self = this
    this.#button = new button({
      onPush() {
        self.onChanged?.()
      },
    })
  }
  read() {
    return this.#button.read() ?? 1
  }
}

function createRobot() {
  const drivers = new Map<string, new (param: unknown) => Driver>([
    ['scservo', SCServoDriver],
    ['dynamixel', DynamixelDriver],
    ['pwm', PWMServoDriver],
    ['rs30x', RS30XDriver],
    ['none', NoneDriver],
  ])
  const ttsEngines = new Map<string, new (param: unknown) => TTS>([
    ['local', LocalTTS],
    ['remote', RemoteTTS],
    ['voicevox', VoiceVoxTTS],
    ['voicevox-web', VoiceVoxWebTTS],
    ['elevenlabs', ElevenLabsTTS],
    ['openai', OpenAITTS],
  ])
  const renderers = new Map<string, new (param: unknown) => Renderer>([
    ['dog', DogFaceRenderer],
    ['simple', SimpleRenderer],
    ['small-face', SmallFaceRenderer],
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

  const driver = new Driver(driverPrefs)
  const renderer = new Renderer(rendererPrefs)
  const tts = new TTS(ttsPrefs)
  const button = globalThis.button

  // TODO(@meganetaaan): screen.touch does not exist under Commodetto context. Is this check necessary?
  interface GlobalEnvironment {
    screen?: {
      touch?: unknown
    }
    device?: {
      sensor?: {
        Touch?: unknown
      }
    }
  }
  const _globalEnv = globalThis as unknown as GlobalEnvironment
  // const TouchConstructor = _globalEnv.device?.sensor?.Touch
  // const touch = TouchConstructor ? new Touch(TouchConstructor) : undefined
  const touch = undefined
  const microphone = Modules.has('embedded:io/audio/in') ? new Microphone() : undefined
  const tone = new Tone({ volume: ttsPrefs.volume })

  const configLed = config.led || {}
  const led = Object.fromEntries(
    Object.entries(configLed).map(([key, config]) => [
      key,
      new Led(config as { pin: number; length?: number; order?: string }),
    ]),
  )

  return new Robot({
    driver,
    renderer,
    tts,
    button,
    touch,
    tone,
    microphone,
    led,
  })
}

async function checkAndConnectWiFi() {
  const wifiPrefs = loadPreferences('wifi')
  if (wifiPrefs.ssid == null || wifiPrefs.password == null) {
    return
  }
  return new Promise<void>((resolve, reject) => {
    globalThis.network = new NetworkService({
      ssid: wifiPrefs.ssid,
      password: wifiPrefs.password,
    })
    globalThis.network.connect(resolve, reject)
  })
}

async function main() {
  if (globalThis.Host?.Button && !globalThis.button) {
    globalThis.button = {
      a: new SimButton(globalThis.Host.Button.a),
      b: new SimButton(globalThis.Host.Button.b),
      c: new SimButton(globalThis.Host.Button.c),
    }
  }
  await asyncWait(100)
  await checkAndConnectWiFi().catch((msg) => {
    trace(`WiFi connection failed: ${msg}`)
  })
  let { onRobotCreated, onLaunch } = defaultMod
  if (Modules.has('mod')) {
    const mod = Modules.importNow('mod') as StackchanMod
    onRobotCreated = mod.onRobotCreated ?? onRobotCreated
    onLaunch = mod.onLaunch ?? onLaunch
  }
  const shouldRobotCreate = await (onLaunch?.() ?? true)
  if (shouldRobotCreate) {
    const robot = createRobot()
    await onRobotCreated?.(robot, globalThis.device)
  }
}

main()
