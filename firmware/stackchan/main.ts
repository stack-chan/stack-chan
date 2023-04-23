declare const global: any

import config from 'mc/config'
import Modules from 'modules'
import { Robot, Driver, TTS, Renderer } from 'robot'
import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import { NoneDriver } from 'none-driver'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as RemoteTTS } from 'tts-remote'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { defaultMod, StackchanMod } from 'stackchan-mod'
import { Renderer as SimpleRenderer } from 'face-renderer'
import { Renderer as DogFaceRenderer } from 'dog-face-renderer'
import Touch from 'touch'

// trace(`modules of mod: ${JSON.stringify(Modules.archive)}\n`)
// trace(`modules of host: ${JSON.stringify(Modules.host)}\n`)

let { onRobotCreated } = defaultMod
if (Modules.has('mod')) {
  const mod = Modules.importNow('mod') as StackchanMod
  onRobotCreated = mod.onRobotCreated ?? onRobotCreated
}

const drivers = new Map<string, new (param: unknown) => Driver>([
  ['scservo', SCServoDriver],
  ['pwm', PWMServoDriver],
  ['rs30x', RS30XDriver],
  ['none', NoneDriver],
])
const ttsEngines = new Map<string, new (param: unknown) => TTS>([
  ['local', LocalTTS],
  ['remote', RemoteTTS],
  ['voicevox', VoiceVoxTTS],
])
const renderers = new Map<string, new (param: unknown) => Renderer>([
  ['dog', DogFaceRenderer],
  ['simple', SimpleRenderer],
])

// TODO: select driver/tts/renderer by mod

const errors: string[] = []

// Servo Driver
const driverKey = config.driver?.type ?? 'scservo'
const Driver = drivers.get(driverKey)

// TTS
const ttsKey = config.tts?.type ?? 'local'
const TTS = ttsEngines.get(ttsKey)

// Renderer
const rendererKey = config.renderer?.type ?? 'simple'
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

const driver = new Driver({
  ...config.driver,
})
const renderer = new Renderer({
  ...config.renderer,
})
const tts = new TTS({
  ...config.tts,
})
const button = globalThis.button
const touch = !global.screen.touch && config.Touch ? new Touch() : undefined
const robot = new Robot({
  driver,
  renderer,
  tts,
  button,
  touch,
})

onRobotCreated?.(robot, globalThis.device)
