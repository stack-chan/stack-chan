import { EmotionNames, emotionFromName } from 'face-state'
import Timer from 'timer'
import type { ChatTool } from '../modules/conversation/chat-tool.js'

const MOTION_STEP_SECONDS = 0.22
const MOTION_STEP_MS = MOTION_STEP_SECONDS * 1000
const DEFAULT_TONE_DURATION_MS = 220
const MIN_TONE_DURATION_MS = 30
const MAX_TONE_DURATION_MS = 2000
const MIN_TONE_HZ = 40
const MAX_TONE_HZ = 4000
const MAX_TONE_COUNT = 32
const MAX_MELODY_DURATION_MS = 15_000

const MOTION_NAMES = ['nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down', 'center'] as const
const LED_MODES = ['solid', 'blink', 'rainbow', 'off'] as const

type MotionName = (typeof MOTION_NAMES)[number]
type LedMode = (typeof LED_MODES)[number]

type Delay = (milliseconds: number) => Promise<void>

type RobotChatContext = {
  face: {
    setEmotion(emotion: number): void
  }
  motion: {
    pose: {
      body: {
        position: { x: number; y: number; z: number }
        rotation: { y: number; p: number; r: number }
      }
    }
    lookAway(): void
    setPose(
      pose: { position: { x: number; y: number; z: number }; rotation: { y: number; p: number; r: number } },
      time?: number,
    ): Promise<void>
    setTorque(enabled: boolean): Promise<void>
  }
  audio: {
    tone(hz: number, duration: number, volume?: number): Promise<void>
  }
  input: {
    imu?: {
      readonly lastSample: {
        accelerometer?: { x: number; y: number; z: number }
        gyroscope?: { x: number; y: number; z: number }
      }
    }
  }
  lighting: {
    led: Record<string, unknown>
    lightOn(ledName: string, r: number, g: number, b: number): void
    lightOff(ledName: string): void
    lightBlink(ledName: string, r: number, g: number, b: number, duration: number): void
    lightRainbow(ledName: string): void
  }
}

export type RobotChatToolOptions = {
  delay?: Delay
  runWithInputSuspended?: <T>(operation: () => Promise<T>) => Promise<T>
}

type ParsedTone = { type: 'tone'; hz: number; duration: number } | { type: 'rest'; duration: number }

const NOTE_OFFSETS_FROM_A: Record<string, number> = {
  C: -9,
  D: -7,
  E: -5,
  F: -4,
  G: -2,
  A: 0,
  B: 2,
}

const REST_NAMES = ['R', 'REST', 'PAUSE']

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => Timer.set(() => resolve(), milliseconds))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`)
  }
  if (value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`)
  return value
}

function optionalVolume(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('volume must be between 0 and 1')
  }
  return value
}

function parseDuration(rawDuration: string | undefined): number {
  const parsed = Number.parseInt(rawDuration ?? `${DEFAULT_TONE_DURATION_MS}`, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_TONE_DURATION_MS
  return clamp(parsed, MIN_TONE_DURATION_MS, MAX_TONE_DURATION_MS)
}

function noteToHz(noteName: string, accidental: string, octaveRaw?: string): number | undefined {
  const baseOffset = NOTE_OFFSETS_FROM_A[noteName]
  if (baseOffset === undefined) return undefined
  let offset = baseOffset
  if (accidental === '#') offset += 1
  if (accidental === 'b' || accidental === 'B') offset -= 1
  const octave = octaveRaw === undefined ? 4 : Number.parseInt(octaveRaw, 10)
  if (!Number.isFinite(octave)) return undefined
  offset += (octave - 4) * 12
  return clamp(Math.round(440 * 2 ** (offset / 12)), MIN_TONE_HZ, MAX_TONE_HZ)
}

export function parseToneToken(token: unknown): ParsedTone | undefined {
  if (typeof token !== 'string') return undefined
  const trimmed = token.trim()
  if (!trimmed) return undefined

  const restMatch = /^([A-Za-z]+)(?:[:/,]\s*(\d+))?$/.exec(trimmed)
  if (restMatch && REST_NAMES.includes(restMatch[1].toUpperCase())) {
    return { type: 'rest', duration: parseDuration(restMatch[2]) }
  }

  const noteMatch = /^([A-Ga-g])([#b]?)(-?\d+)?(?:[:/,]\s*(\d+))?$/.exec(trimmed)
  if (noteMatch) {
    const hz = noteToHz(noteMatch[1].toUpperCase(), noteMatch[2], noteMatch[3])
    if (hz === undefined) return undefined
    return { type: 'tone', hz, duration: parseDuration(noteMatch[4]) }
  }

  const frequencyMatch = /^(\d+(?:\.\d+)?)(?:[:/,]\s*(\d+))?$/.exec(trimmed)
  if (!frequencyMatch) return undefined
  const frequency = Number.parseFloat(frequencyMatch[1])
  if (!Number.isFinite(frequency)) return undefined
  return {
    type: 'tone',
    hz: clamp(Math.round(frequency), MIN_TONE_HZ, MAX_TONE_HZ),
    duration: parseDuration(frequencyMatch[2]),
  }
}

function poseFor(robot: RobotChatContext, rotation: { y: number; p: number; r: number }) {
  return {
    position: { ...robot.motion.pose.body.position },
    rotation,
  }
}

async function playMotion(robot: RobotChatContext, motion: MotionName, delay: Delay): Promise<string> {
  const start = { ...robot.motion.pose.body.rotation }
  const left = { y: Math.PI / 6, p: 0, r: 0 }
  const right = { y: -Math.PI / 6, p: 0, r: 0 }
  const up = { y: 0, p: -Math.PI / 6, r: 0 }
  const down = { y: 0, p: Math.PI / 32, r: 0 }
  const center = { y: 0, p: 0, r: 0 }

  robot.motion.lookAway()
  await robot.motion.setTorque(true)
  try {
    if (motion === 'nod') {
      await robot.motion.setPose(poseFor(robot, down), MOTION_STEP_SECONDS)
      await delay(MOTION_STEP_MS)
      await robot.motion.setPose(poseFor(robot, up), MOTION_STEP_SECONDS)
      await delay(MOTION_STEP_MS)
      await robot.motion.setPose(poseFor(robot, start), MOTION_STEP_SECONDS)
    } else if (motion === 'shake_head') {
      await robot.motion.setPose(poseFor(robot, left), MOTION_STEP_SECONDS)
      await delay(MOTION_STEP_MS)
      await robot.motion.setPose(poseFor(robot, right), MOTION_STEP_SECONDS)
      await delay(MOTION_STEP_MS)
      await robot.motion.setPose(poseFor(robot, start), MOTION_STEP_SECONDS)
    } else {
      const target = {
        look_left: left,
        look_right: right,
        look_up: up,
        look_down: down,
        center,
      }[motion as Exclude<MotionName, 'nod' | 'shake_head'>]
      await robot.motion.setPose(poseFor(robot, target), MOTION_STEP_SECONDS)
    }
  } finally {
    await robot.motion.setTorque(false)
  }
  return `Motion played: ${motion}`
}

function parseMotion(value: unknown): MotionName {
  if (typeof value !== 'string' || !MOTION_NAMES.includes(value as MotionName)) {
    throw new RangeError(`motion must be one of: ${MOTION_NAMES.join(', ')}`)
  }
  return value as MotionName
}

function parseLedMode(value: unknown): LedMode {
  if (typeof value !== 'string' || !LED_MODES.includes(value as LedMode)) {
    throw new RangeError(`mode must be one of: ${LED_MODES.join(', ')}`)
  }
  return value as LedMode
}

function createLedTool(robot: RobotChatContext, ledNames: string[]): ChatTool {
  return {
    name: 'set_led',
    description: "Control Stack-chan's configured LEDs",
    parameters: {
      type: 'object',
      properties: {
        led: { type: 'string', enum: ledNames, description: 'LED name' },
        mode: { type: 'string', enum: [...LED_MODES], description: 'Lighting mode' },
        red: { type: 'integer', minimum: 0, maximum: 255 },
        green: { type: 'integer', minimum: 0, maximum: 255 },
        blue: { type: 'integer', minimum: 0, maximum: 255 },
        interval_ms: { type: 'integer', minimum: 50, maximum: 10_000 },
      },
      required: ['led', 'mode'],
      additionalProperties: false,
    },
    execute: ({ led, mode, red, green, blue, interval_ms }) => {
      if (typeof led !== 'string' || !ledNames.includes(led)) throw new RangeError(`Unknown LED: ${String(led)}`)
      const parsedMode = parseLedMode(mode)
      if (parsedMode === 'off') robot.lighting.lightOff(led)
      else if (parsedMode === 'rainbow') robot.lighting.lightRainbow(led)
      else {
        const r = finiteInteger(red, 'red', 0, 255)
        const g = finiteInteger(green, 'green', 0, 255)
        const b = finiteInteger(blue, 'blue', 0, 255)
        if (parsedMode === 'solid') robot.lighting.lightOn(led, r, g, b)
        else robot.lighting.lightBlink(led, r, g, b, finiteInteger(interval_ms, 'interval_ms', 50, 10_000))
      }
      return `LED ${led} set to ${parsedMode}`
    },
  }
}

export function createRobotChatTools(
  robot: RobotChatContext,
  options: RobotChatToolOptions = {},
): Record<string, ChatTool> {
  const delay = options.delay ?? defaultDelay
  const runWithInputSuspended =
    options.runWithInputSuspended ?? (async <T>(operation: () => Promise<T>): Promise<T> => operation())
  const ledNames = Object.keys(robot.lighting.led)

  const tools: Record<string, ChatTool> = {
    set_emotion: {
      name: 'set_emotion',
      description: "Set Stack-chan's facial emotion",
      parameters: {
        type: 'object',
        properties: {
          emotion: { type: 'string', enum: [...EmotionNames], description: 'Facial emotion' },
        },
        required: ['emotion'],
        additionalProperties: false,
      },
      execute: ({ emotion }) => {
        const nextEmotion = typeof emotion === 'string' ? emotionFromName(emotion) : undefined
        if (nextEmotion === undefined) throw new RangeError(`Unknown emotion: ${String(emotion)}`)
        robot.face.setEmotion(nextEmotion)
        return `Emotion set to ${String(emotion).toUpperCase()}`
      },
    },
    play_motion: {
      name: 'play_motion',
      description: 'Play a safe, semantic head motion',
      parameters: {
        type: 'object',
        properties: {
          motion: { type: 'string', enum: [...MOTION_NAMES], description: 'Motion to play' },
        },
        required: ['motion'],
        additionalProperties: false,
      },
      execute: ({ motion }) => playMotion(robot, parseMotion(motion), delay),
    },
    play_melody: {
      name: 'play_melody',
      description: 'Play notes, frequencies, and rests as a short melody',
      parameters: {
        type: 'object',
        properties: {
          tones: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: MAX_TONE_COUNT,
            description: 'Tokens such as C4:220, F#4:180, 440:200, or R:120',
          },
          volume: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['tones'],
        additionalProperties: false,
      },
      execute: async ({ tones, volume }) => {
        if (!Array.isArray(tones) || tones.length === 0) throw new RangeError('tones must be a non-empty array')
        const parsedVolume = optionalVolume(volume)
        const parsed = tones.slice(0, MAX_TONE_COUNT).map(parseToneToken)
        let played = 0
        let rests = 0
        const skipped = parsed.filter((tone) => tone === undefined).length
        let durationMs = 0
        let truncated = Math.max(0, tones.length - MAX_TONE_COUNT)

        await runWithInputSuspended(async () => {
          for (let index = 0; index < parsed.length; index += 1) {
            const tone = parsed[index]
            if (!tone) continue
            if (durationMs + tone.duration > MAX_MELODY_DURATION_MS) {
              truncated += parsed.slice(index).filter((candidate) => candidate !== undefined).length
              break
            }
            durationMs += tone.duration
            if (tone.type === 'rest') {
              rests += 1
              await delay(tone.duration)
            } else {
              played += 1
              await robot.audio.tone(tone.hz, tone.duration, parsedVolume)
            }
          }
        })

        return JSON.stringify({ played, rests, skipped, truncated, duration_ms: durationMs })
      },
    },
    get_robot_status: {
      name: 'get_robot_status',
      description: "Read Stack-chan's pose and available hardware state",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: () => {
        const imu = robot.input.imu
        return JSON.stringify({
          pose: {
            position: { ...robot.motion.pose.body.position },
            rotation: { ...robot.motion.pose.body.rotation },
          },
          leds: ledNames,
          imu: {
            available: imu !== undefined,
            sample: imu?.lastSample ?? {},
          },
        })
      },
    },
  }

  if (ledNames.length > 0) tools.set_led = createLedTool(robot, ledNames)
  return tools
}
