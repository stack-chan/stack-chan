import type { MotionPort } from 'motion-port'
import type { OperationClock } from 'operation-queue'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { MotionResult } from 'stackchan/motion'
import type { Maybe, Rotation } from 'stackchan-util'

export type MotionClock = OperationClock & { now(): number }
type Options = {
  port: MotionPort
  clock: MotionClock
  target: Rotation
  durationMs: number
  timeoutMs: number
  onPosition(rotation: Rotation): void
  onDone(result: MotionResult): void
  onError(error: StackchanError): void
}
const PREPARE = 0
const ORIGIN = 1
const FRAME = 2
const ARRIVAL = 3
const HOLD_READ = 4
const HOLD_WRITE = 5
const HOLD_CONFIRM = 6
const TOLERANCE = Math.PI / 180
const STOP_TIMEOUT_MS = 2_000

/** One trajectory; driver callbacks and rotation buffers are reused throughout its frames. */
export class MotionExecution {
  readonly #options: Options
  #phase = PREPARE
  #origin: Rotation = { y: 0, p: 0, r: 0 }
  #command: Rotation = { y: 0, p: 0, r: 0 }
  #hold: Rotation = { y: 0, p: 0, r: 0 }
  #startedAt = 0
  #finalFrame = false
  #confirmations = 0
  #pending = false
  #acquired = false
  #done = false
  #failure: unknown
  #timerGeneration = 0
  #clearFrame: (() => void) | undefined
  #clearDeadline: (() => void) | undefined
  #stopPromise: Promise<void> | undefined
  #resolveStop: (() => void) | undefined
  #rejectStop: ((error: unknown) => void) | undefined

  constructor(options: Options) {
    this.#options = options
  }

  start(): void {
    if (this.#done || this.#stopPromise) return
    try {
      this.#clearDeadline = this.#options.clock.after(this.#options.timeoutMs, () => {
        if (!this.#stopPromise) this.#error(new StackchanError('TIMEOUT', 'Motion did not arrive before its deadline'))
      })
      this.#schedule(() => {
        if (this.#stopPromise) return
        this.#pending = true
        this.#acquired = true
        try {
          this.#options.port.prepare(this.#onPrepared)
        } catch (error) {
          this.#pending = false
          this.#error(error)
        }
      }, 0)
    } catch (error) {
      this.#pending = false
      this.#error(error)
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = new Promise<void>((resolve, reject) => {
      this.#resolveStop = resolve
      this.#rejectStop = reject
    })
    if (this.#done) {
      if (this.#failure !== undefined) this.#rejectStop(this.#failure)
      else this.#resolveStop()
      return this.#stopPromise
    }
    this.#clearTimers()
    if (!this.#acquired) {
      this.#done = true
      this.#resolveStop()
      return this.#stopPromise
    }
    try {
      this.#clearDeadline = this.#options.clock.after(STOP_TIMEOUT_MS, () =>
        this.#finishStop(new StackchanError('TIMEOUT', 'Motion stop was not confirmed')),
      )
      if (!this.#pending) this.#schedule(() => this.#read(HOLD_READ), 0)
    } catch (error) {
      this.#finishStop(error)
    }
    return this.#stopPromise
  }

  #onPrepared = (error?: unknown): void => {
    if (this.#done || !this.#pending || this.#phase !== PREPARE) return
    this.#pending = false
    if (error != null) {
      this.#error(error)
      return
    }
    // A synchronous prepare may itself contain read/write/torque callbacks.
    // Unwind that chain before starting a trajectory in the bounded XS stack.
    this.#schedule(() => this.#read(this.#stopPromise ? HOLD_READ : ORIGIN), 0)
  }

  #read(phase: number): void {
    if (this.#done) return
    this.#phase = phase
    this.#pending = true
    try {
      this.#options.port.read(this.#onRead)
    } catch (error) {
      this.#pending = false
      this.#error(error)
    }
  }

  #onRead = (sample: Maybe<Rotation>): void => {
    if (this.#done || !this.#pending) return
    this.#pending = false
    if (sample.success === false) {
      this.#error(new Error(sample.reason ?? 'Motion position is unavailable'))
      return
    }
    const position = sample.value
    if (!Number.isFinite(position.y) || !Number.isFinite(position.p) || !Number.isFinite(position.r)) {
      this.#error(new Error('Motion position sample is invalid'))
      return
    }
    try {
      this.#options.onPosition(position)
    } catch (error) {
      this.#error(error)
      return
    }
    if (this.#stopPromise && this.#phase !== HOLD_CONFIRM) {
      const info = this.#options.port.info
      const yaw = (position.y * 180) / Math.PI
      const pitch = (position.p * 180) / Math.PI
      if (
        info.availability === 'unavailable' ||
        yaw < info.yawDeg[0] - 1 ||
        yaw > info.yawDeg[1] + 1 ||
        pitch < info.pitchDeg[0] - 1 ||
        pitch > info.pitchDeg[1] + 1
      ) {
        this.#finishStop(new Error('Cannot hold a position outside the calibrated motion range'))
        return
      }
      this.#copy(position, this.#hold)
      this.#write(this.#hold, HOLD_WRITE)
      return
    }
    if (this.#phase === ORIGIN) {
      this.#copy(position, this.#origin)
      this.#startedAt = this.#options.clock.now()
      if (this.#options.durationMs === 0) this.#frame()
      else this.#schedule(() => this.#frame(), Math.min(this.#options.port.intervalMs, this.#options.durationMs))
      return
    }
    const stopping = this.#phase === HOLD_CONFIRM
    const goal = stopping ? this.#hold : this.#options.target
    const arrived = Math.abs(position.y - goal.y) <= TOLERANCE && Math.abs(position.p - goal.p) <= TOLERANCE
    this.#confirmations = arrived ? this.#confirmations + 1 : 0
    if (this.#confirmations >= 2) {
      if (stopping) this.#finishStop()
      else this.#complete('measured')
    } else
      this.#schedule(() => this.#read(stopping ? HOLD_CONFIRM : ARRIVAL), Math.max(50, this.#options.port.intervalMs))
  }

  #frame(): void {
    if (this.#done || this.#stopPromise) return
    const elapsed = (this.#options.clock.now() - this.#startedAt) >>> 0
    const ratio = this.#options.durationMs === 0 ? 1 : Math.min(1, elapsed / this.#options.durationMs)
    const eased = (1 - Math.cos(Math.PI * ratio)) / 2
    this.#command.y = this.#origin.y + (this.#options.target.y - this.#origin.y) * eased
    this.#command.p = this.#origin.p + (this.#options.target.p - this.#origin.p) * eased
    this.#command.r = 0
    this.#finalFrame = ratio === 1
    this.#write(this.#command, FRAME)
  }

  #write(rotation: Rotation, phase: number): void {
    this.#phase = phase
    this.#pending = true
    try {
      this.#options.port.write(rotation, this.#onWritten)
    } catch (error) {
      this.#pending = false
      this.#error(error)
    }
  }

  #onWritten = (error?: unknown): void => {
    if (this.#done || !this.#pending) return
    this.#pending = false
    if (error != null) {
      this.#error(error)
      return
    }
    if (this.#stopPromise) {
      if (this.#phase !== HOLD_WRITE) {
        this.#read(HOLD_READ)
        return
      }
      if (this.#options.port.info.availability !== 'unavailable' && this.#options.port.info.feedback === 'measured') {
        this.#confirmations = 0
        this.#read(HOLD_CONFIRM)
      } else this.#finishStop()
      return
    }
    try {
      this.#options.onPosition(this.#command)
    } catch (error) {
      this.#error(error)
      return
    }
    if (this.#finalFrame) {
      if (this.#options.port.info.availability !== 'unavailable' && this.#options.port.info.feedback === 'measured') {
        this.#confirmations = 0
        this.#read(ARRIVAL)
      } else this.#complete('estimated')
      return
    }
    const elapsed = (this.#options.clock.now() - this.#startedAt) >>> 0
    this.#schedule(
      () => this.#frame(),
      Math.max(1, Math.min(this.#options.port.intervalMs, this.#options.durationMs - elapsed)),
    )
  }

  #schedule(callback: () => void, milliseconds: number): void {
    try {
      const generation = ++this.#timerGeneration
      this.#clearFrame = this.#options.clock.after(milliseconds, () => {
        if (generation !== this.#timerGeneration) return
        this.#clearFrame = undefined
        if (!this.#done) callback()
      })
    } catch (error) {
      this.#error(error)
    }
  }

  #complete(completion: MotionResult['completion']): void {
    this.#done = true
    this.#clearTimers()
    try {
      this.#options.port.release()
    } catch (error) {
      this.#failure = asStackchanError(error)
      this.#options.onError(this.#failure as StackchanError)
      return
    }
    this.#options.onDone({ completion })
  }

  #finishStop(error?: unknown): void {
    if (this.#done) return
    this.#done = true
    this.#clearTimers()
    try {
      this.#options.port.release(error)
    } catch (releaseError) {
      error ??= asStackchanError(releaseError)
    }
    if (error != null) {
      this.#failure = asStackchanError(error)
      this.#rejectStop?.(this.#failure)
    } else this.#resolveStop?.()
  }

  #error(error: unknown): void {
    if (this.#done) return
    if (this.#stopPromise) this.#finishStop(error)
    else this.#options.onError(asStackchanError(error))
  }

  #clearTimers(): void {
    this.#timerGeneration += 1
    this.#clearFrame?.()
    this.#clearDeadline?.()
    this.#clearFrame = this.#clearDeadline = undefined
  }

  #copy(from: Rotation, to: Rotation): void {
    to.y = from.y
    to.p = from.p
    to.r = from.r
  }
}
