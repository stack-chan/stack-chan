const PROTOCOL_VERSION = 1
const MAX_TTS_CHARACTERS = 200
const MAX_AXIS_DEGREES = 90
const DEFAULT_MOTION_DURATION_MS = 300
const MAX_MOTION_DURATION_MS = 30_000

export type CameraHubCommand = {
  type: 'command'
  protocol: 1
  commandId: string
  command: string
  payload?: Record<string, unknown>
}

export type CameraHubCommandAck = {
  type: 'command.ack'
  protocol: 1
  commandId: string
  command: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

type SpeechResult =
  | {
      success: true
      value: string
    }
  | {
      success: false
      reason?: string
    }

type BodyPose = {
  position: {
    x: number
    y: number
    z: number
  }
  rotation: {
    y: number
    p: number
    r: number
  }
}

export type CameraHubCommandTarget = {
  audio: {
    say(text: string, volume?: number): Promise<SpeechResult>
  }
  motion: {
    pose: {
      body: BodyPose
    }
    setPose(pose: BodyPose, timeSeconds?: number): Promise<void>
  }
}

export type CameraHubCommandCapability = {
  execute(message: CameraHubCommand): Promise<CameraHubCommandAck>
}

class CameraHubCommandError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function payloadOf(message: CameraHubCommand): Record<string, unknown> {
  const payload = message.payload ?? {}
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new CameraHubCommandError('invalid_payload', 'payload must be an object')
  }
  return payload
}

function numberInRange(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CameraHubCommandError('invalid_payload', `${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function durationMilliseconds(payload: Record<string, unknown>): number {
  const value = payload.durationMs ?? DEFAULT_MOTION_DURATION_MS
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_MOTION_DURATION_MS) {
    throw new CameraHubCommandError('invalid_payload', `durationMs must be between 1 and ${MAX_MOTION_DURATION_MS}`)
  }
  return value as number
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CameraHubCommandAdapter implements CameraHubCommandCapability {
  readonly #target: CameraHubCommandTarget

  constructor(target: CameraHubCommandTarget) {
    this.#target = target
  }

  async execute(message: CameraHubCommand): Promise<CameraHubCommandAck> {
    try {
      if (
        message.type !== 'command' ||
        message.protocol !== PROTOCOL_VERSION ||
        typeof message.commandId !== 'string' ||
        message.commandId.length === 0
      ) {
        throw new CameraHubCommandError('invalid_command', 'invalid command envelope')
      }

      const payload = payloadOf(message)
      let result: unknown
      if (message.command === 'tts.speak') result = await this.#speak(payload)
      else if (message.command === 'panTilt.move') result = await this.#move(payload)
      else throw new CameraHubCommandError('not_supported', `${message.command} is not supported by Stack-chan`)

      return {
        type: 'command.ack',
        protocol: PROTOCOL_VERSION,
        commandId: message.commandId,
        command: message.command,
        ok: true,
        result,
      }
    } catch (error) {
      return {
        type: 'command.ack',
        protocol: PROTOCOL_VERSION,
        commandId: typeof message.commandId === 'string' ? message.commandId : '',
        command: typeof message.command === 'string' ? message.command : '',
        ok: false,
        error: {
          code: error instanceof CameraHubCommandError ? error.code : 'command_failed',
          message: errorMessage(error),
        },
      }
    }
  }

  async #speak(payload: Record<string, unknown>): Promise<unknown> {
    const text = payload.text
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TTS_CHARACTERS) {
      throw new CameraHubCommandError('invalid_payload', `text must be between 1 and ${MAX_TTS_CHARACTERS} characters`)
    }
    const volume = payload.volume
    if (volume !== undefined) numberInRange(volume, 0, 1, 'volume')

    const spoken = await this.#target.audio.say(text, volume as number | undefined)
    if (spoken.success === false) {
      throw new CameraHubCommandError('tts_failed', spoken.reason ?? 'speech synthesis failed')
    }
    return { spoken: true, text: spoken.value }
  }

  async #move(payload: Record<string, unknown>): Promise<unknown> {
    const pan = numberInRange(payload.pan, -MAX_AXIS_DEGREES, MAX_AXIS_DEGREES, 'pan')
    const tilt = numberInRange(payload.tilt, -MAX_AXIS_DEGREES, MAX_AXIS_DEGREES, 'tilt')
    const durationMs = durationMilliseconds(payload)
    const current = this.#target.motion.pose.body
    const pose: BodyPose = {
      position: { ...current.position },
      rotation: {
        y: radians(pan),
        p: -radians(tilt),
        r: current.rotation.r,
      },
    }
    await this.#target.motion.setPose(pose, durationMs / 1000)
    return { pan, tilt, durationMs }
  }
}

export function createCameraHubCommandCapability(target: CameraHubCommandTarget): CameraHubCommandCapability {
  return new CameraHubCommandAdapter(target)
}
