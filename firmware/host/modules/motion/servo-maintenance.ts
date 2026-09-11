import { finiteNumber, StackchanError } from 'stackchan/errors'
import type { ServoAxis, ServoKind, ServoStatus } from 'stackchan/extensions/maintenance'

type Result<T> = { success: true; value: T } | { success: false; reason?: string }
type Done = (error?: unknown) => void
type CommonServo = { flashId(id: number, done: Done): void }
type ServoProtocols = {
  scservo: CommonServo & {
    readStatus(done: (value: Result<{ angle: number }>) => void): void
    readOffsetAngle(done: (value: Result<number>) => void): void
    readRawPosition(done: (value: Result<{ position: number }>) => void): void
    setOffsetAngle(value: number, done: Done): void
    saveSettings(done: Done): void
  }
  rs30x: CommonServo & { readStatus(done: (angle?: number, error?: unknown) => void): void }
  dynamixel: CommonServo & {
    readPresentPosition(done: (value: Result<number>) => void): void
    readPresentCurrent(done: (value: Result<{ current: number }>) => void): void
    readPresentVelocity(done: (value: Result<number>) => void): void
    setLED(enabled: boolean, done: Done): void
    setBaudrate(code: 0 | 1 | 2 | 3 | 4 | 5 | 6, done: Done): void
  }
}
export type MaintenanceCommand = { axis: ServoAxis } & (
  | { operation: 'read' | 'calibrate' }
  | { operation: 'led'; enabled: boolean }
  | { operation: 'id'; id: number }
  | { operation: 'baudrate'; baudrate: number }
)
export type ServoMaintenancePort = {
  readonly kind: ServoKind
  execute(command: MaintenanceCommand, done: (error?: unknown, status?: ServoStatus) => void): void
}
type Action = (done: (error?: unknown) => void) => void
function sequence(actions: Action[], done: (error?: unknown) => void): void {
  let index = 0
  const next = (error?: unknown) => {
    if (error != null || index === actions.length) {
      done(error)
      return
    }
    try {
      actions[index++](next)
    } catch (error) {
      done(error)
    }
  }
  next()
}
function readResult<T>(invoke: (done: (result: Result<T>) => void) => void, receive: (value: T) => void): Action {
  return (done) =>
    invoke((result) => {
      if (result.success === false) {
        done(new StackchanError('IO', result.reason ?? 'Servo did not respond'))
        return
      }
      receive(result.value)
      done()
    })
}

/** Translates maintenance commands on the driver's existing bus endpoints. */
export function createServoMaintenance<K extends ServoKind>(
  kind: K,
  pan: ServoProtocols[K],
  tilt: ServoProtocols[K],
): ServoMaintenancePort {
  return {
    kind,
    execute(command, done) {
      try {
        const { axis } = command
        if (axis !== 'pan' && axis !== 'tilt') throw new StackchanError('INVALID_ARGUMENT', 'Unknown servo axis')
        const device = axis === 'pan' ? pan : tilt
        const unsupported = () =>
          done(new StackchanError('UNSUPPORTED', 'Maintenance operation is unavailable for this servo'))
        switch (command.operation) {
          case 'read': {
            const status: ServoStatus = { axis, angleDeg: 0 }
            const finish = (error?: unknown) => done(error, error == null ? status : undefined)
            if (kind === 'dynamixel') {
              const servo = device as ServoProtocols['dynamixel']
              sequence(
                [
                  readResult<number>(
                    (next) => servo.readPresentPosition(next),
                    (value) => {
                      status.angleDeg = (value * 360) / 4096 - 180
                    },
                  ),
                  readResult<{ current: number }>(
                    (next) => servo.readPresentCurrent(next),
                    (value) => {
                      status.current = value.current
                    },
                  ),
                  readResult<number>(
                    (next) => servo.readPresentVelocity(next),
                    (value) => {
                      status.velocity = value
                    },
                  ),
                ],
                finish,
              )
            } else if (kind === 'scservo') {
              const servo = device as ServoProtocols['scservo']
              sequence(
                [
                  readResult<{ angle: number }>(
                    (next) => servo.readStatus(next),
                    (value) => {
                      status.angleDeg = value.angle
                    },
                  ),
                  readResult<number>(
                    (next) => servo.readOffsetAngle(next),
                    (value) => {
                      status.offsetDeg = value
                    },
                  ),
                ],
                finish,
              )
            } else {
              const servo = device as ServoProtocols['rs30x']
              servo.readStatus((value, error) => {
                if (value != null) status.angleDeg = value
                finish(error ?? (value == null ? new StackchanError('IO', 'Servo did not respond') : undefined))
              })
            }
            return
          }
          case 'calibrate': {
            if (kind !== 'scservo') {
              unsupported()
              return
            }
            const servo = device as ServoProtocols['scservo']
            let offset = 0
            // SCServo neutral is 100 degrees. Raw position makes repeated calibration idempotent.
            sequence(
              [
                readResult<{ position: number }>(
                  (next) => servo.readRawPosition(next),
                  (value) => {
                    offset = Math.round((value.position * 200) / 1024 - 100)
                  },
                ),
                (next) => servo.setOffsetAngle(offset, next),
                (next) => servo.saveSettings(next),
              ],
              done,
            )
            return
          }
          case 'led':
            if (kind === 'dynamixel') (device as ServoProtocols['dynamixel']).setLED(command.enabled, done)
            else unsupported()
            return
          case 'id':
            finiteNumber(command.id, 'servo ID', 1, kind === 'rs30x' ? 127 : 253)
            if (!Number.isInteger(command.id))
              throw new StackchanError('INVALID_ARGUMENT', 'Servo ID must be an integer')
            device.flashId(command.id, done)
            return
          case 'baudrate': {
            if (kind !== 'dynamixel') {
              unsupported()
              return
            }
            const code = [9600, 57600, 115200, 1000000, 2000000, 3000000, 4000000].indexOf(command.baudrate)
            if (code < 0) throw new StackchanError('INVALID_ARGUMENT', 'Unsupported DYNAMIXEL baudrate')
            const value = code as 0 | 1 | 2 | 3 | 4 | 5 | 6
            sequence(
              [
                (next) => (pan as ServoProtocols['dynamixel']).setBaudrate(value, next),
                (next) => (tilt as ServoProtocols['dynamixel']).setBaudrate(value, next),
              ],
              done,
            )
          }
        }
      } catch (error) {
        done(error)
      }
    },
  }
}
