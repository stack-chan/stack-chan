const PROTOCOL_VERSION = 1
const MAX_TTS_CHARACTERS = 200
const MAX_AXIS_DEGREES = 90
const DEFAULT_MOTION_DURATION_MS = 300
const MAX_MOTION_DURATION_MS = 30_000

let activeHandler

class CameraHubCommandError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function commandEnvelope(message) {
  if (
    !message ||
    typeof message !== 'object' ||
    message.type !== 'command' ||
    message.protocol !== PROTOCOL_VERSION ||
    typeof message.commandId !== 'string' ||
    message.commandId.length === 0 ||
    typeof message.command !== 'string' ||
    message.command.length === 0
  ) {
    throw new CameraHubCommandError('invalid_command', 'invalid command envelope')
  }
  return message
}

function payloadOf(message) {
  const payload = message.payload ?? {}
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new CameraHubCommandError('invalid_payload', 'payload must be an object')
  }
  return payload
}

function numberInRange(value, minimum, maximum, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CameraHubCommandError('invalid_payload', `${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function durationMilliseconds(payload) {
  const value = payload.durationMs ?? DEFAULT_MOTION_DURATION_MS
  if (!Number.isInteger(value) || value < 1 || value > MAX_MOTION_DURATION_MS) {
    throw new CameraHubCommandError('invalid_payload', `durationMs must be between 1 and ${MAX_MOTION_DURATION_MS}`)
  }
  return value
}

function radians(degrees) {
  return (degrees * Math.PI) / 180
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function acknowledgement(message, values) {
  const object = message && typeof message === 'object' ? message : {}
  return {
    type: 'command.ack',
    protocol: PROTOCOL_VERSION,
    commandId: typeof object.commandId === 'string' ? object.commandId : '',
    command: typeof object.command === 'string' ? object.command : '',
    ...values,
  }
}

export class CameraHubCommandHandler {
  #robot

  constructor(robot) {
    this.#robot = robot
  }

  async execute(message) {
    try {
      const command = commandEnvelope(message)
      const payload = payloadOf(command)
      let result
      if (command.command === 'tts.speak') result = await this.#speak(payload)
      else if (command.command === 'panTilt.move') result = await this.#move(payload)
      else throw new CameraHubCommandError('not_supported', `${command.command} is not supported by Stack-chan`)

      return acknowledgement(command, { ok: true, result })
    } catch (error) {
      return acknowledgement(message, {
        ok: false,
        error: {
          code: error instanceof CameraHubCommandError ? error.code : 'command_failed',
          message: errorMessage(error),
        },
      })
    }
  }

  async #speak(payload) {
    const text = payload.text
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TTS_CHARACTERS) {
      throw new CameraHubCommandError('invalid_payload', `text must be between 1 and ${MAX_TTS_CHARACTERS} characters`)
    }
    const volume = payload.volume
    if (volume !== undefined) numberInRange(volume, 0, 1, 'volume')

    const spoken = await this.#robot.audio.say(text, volume)
    if (spoken.success === false) {
      throw new CameraHubCommandError('tts_failed', spoken.reason ?? 'speech synthesis failed')
    }
    return { spoken: true, text: spoken.value }
  }

  async #move(payload) {
    const pan = numberInRange(payload.pan, -MAX_AXIS_DEGREES, MAX_AXIS_DEGREES, 'pan')
    const tilt = numberInRange(payload.tilt, -MAX_AXIS_DEGREES, MAX_AXIS_DEGREES, 'tilt')
    const durationMs = durationMilliseconds(payload)
    const current = this.#robot.motion.pose.body
    const pose = {
      position: { ...current.position },
      rotation: {
        y: radians(pan),
        p: -radians(tilt),
        r: current.rotation.r,
      },
    }
    await this.#robot.motion.setPose(pose, durationMs / 1000)
    return { pan, tilt, durationMs }
  }
}

export function createCameraHubCommandHandler(robot) {
  return new CameraHubCommandHandler(robot)
}

export function onContextCreated(robot) {
  activeHandler = createCameraHubCommandHandler(robot)
  trace('[camera-hub-commands] command handler ready\n')
}

export function executeCameraHubCommand(message) {
  if (!activeHandler) {
    return Promise.resolve(
      acknowledgement(message, {
        ok: false,
        error: { code: 'not_ready', message: 'Stack-chan context is not ready' },
      }),
    )
  }
  return activeHandler.execute(message)
}
