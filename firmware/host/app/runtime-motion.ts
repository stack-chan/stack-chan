import { CancellationSource } from 'cancellation'
import type { MotionDriver } from 'motion-controller'
import { type MotionClock, MotionExecution } from 'motion-execution'
import { OperationQueue } from 'operation-queue'
import { OwnedResources } from 'owned-resources'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { AppMotion, MotionInfo, MotionOptions, MotionResult, MotionTarget } from 'stackchan/motion'
import type { Rotation, Vector3 } from 'stackchan-util'

type Options = {
  clock: MotionClock
  onPosition(rotation: Rotation): void
  onError(error: StackchanError): void
}

/** V2 owns one motion service per app. Device lifetime remains with the host. */
export class StackchanRuntimeMotion implements AppMotion {
  readonly #driver: MotionDriver
  readonly #options: Options
  #queue: OperationQueue
  #position: MotionTarget | undefined
  get position(): MotionTarget | undefined {
    return this.#position ? { ...this.#position } : undefined
  }
  #foreground = 0
  #gaze: MotionTarget | undefined
  #gazePoint: Vector3 | null = null
  #gazeVersion = 0
  #appliedGazeVersion = -1
  #gazeSource: CancellationSource | undefined
  #clearGaze: (() => void) | undefined
  #stopping: Promise<void> | undefined
  #shutdown: OwnedResources | undefined
  #closed = false
  #attached = false
  #canRelax = false
  #failure: StackchanError | undefined

  constructor(driver: MotionDriver, options: Options) {
    this.#driver = driver
    this.#options = {
      ...options,
      onPosition: (rotation) => {
        this.#position = { yawDeg: (rotation.y * 180) / Math.PI, pitchDeg: (rotation.p * 180) / Math.PI }
        options.onPosition(rotation)
      },
    }
    this.#queue = new OperationQueue({ clock: options.clock })
    const info = this.info
    if (info.availability === 'unavailable') return
    for (const range of [info.yawDeg, info.pitchDeg]) {
      if (range?.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1])
        throw new StackchanError('CONFIG', 'The motion driver has invalid calibrated limits')
    }
    finiteNumber(driver.motion.intervalMs, 'motion frame interval', 1, 1000)
    this.#canRelax = info.canRelax
    this.#attached = true
    try {
      driver.onAttached?.()
    } catch (error) {
      this.#attached = false
      try {
        driver.onDetached?.()
      } catch {
        /* Keep the attachment failure. */
      }
      throw error
    }
  }

  get info(): MotionInfo {
    if (this.#closed) return { availability: 'unavailable', reason: 'App motion is closed' }
    if (this.#failure) return { availability: 'unavailable', reason: this.#failure.message }
    if (this.#queue.closed && !this.#stopping)
      return { availability: 'unavailable', reason: 'Motion requires host restart after a failed stop' }
    return (
      this.#driver.motion?.info ?? {
        availability: 'unavailable',
        reason: 'The selected driver has no motion capability',
      }
    )
  }
  get gazePoint(): Vector3 | null {
    return this.#gazePoint
  }

  #maintaining = false
  #maintenance: Promise<unknown> | undefined
  maintain<T>(operation: () => Promise<T>, resume = true): Promise<T> {
    this.#assertReady()
    this.#maintaining = true
    const pending = (async () => {
      try {
        await this.#haltQueue(true)
        this.#attached = false
        this.#driver.onDetached?.()
        if (this.#closed) throw new StackchanError('CLOSED', 'App motion is closed')
        return await operation()
      } finally {
        this.#maintaining = false
        if (!resume)
          this.#failure = new StackchanError('CONFIG', 'Servo bus settings changed; restart with the new baudrate')
        if (!this.#closed && resume) {
          this.#driver.onAttached?.()
          this.#attached = true
        }
      }
    })()
    this.#maintenance = pending
    return pending.finally(() => {
      if (this.#maintenance === pending) this.#maintenance = undefined
    })
  }

  move(target: MotionTarget, options: MotionOptions): Promise<MotionResult> {
    try {
      this.#assertReady()
      target = this.#validateTarget(target)
      this.#validateOptions(options)
      options.signal?.throwIfCancelled()
      options = { ...options }
    } catch (error) {
      return Promise.reject(asStackchanError(error))
    }
    this.#foreground += 1
    this.#appliedGazeVersion = -1
    this.#gazeSource?.cancel()
    this.#cancelGazeTimer()
    return this.#run(target, options).finally(() => {
      this.#foreground -= 1
      this.#scheduleGaze()
    })
  }

  lookAt(target: MotionTarget): void {
    this.#assertReady()
    target = this.#validateTarget(target)
    if (this.#gaze?.yawDeg === target.yawDeg && this.#gaze.pitchDeg === target.pitchDeg) return
    this.#gaze = target
    const y = (target.yawDeg * Math.PI) / 180
    const p = (target.pitchDeg * Math.PI) / 180
    this.#gazePoint = [Math.cos(y) * Math.cos(p), Math.sin(y) * Math.cos(p), -Math.sin(p)]
    this.#gazeVersion += 1
    this.#scheduleGaze()
  }

  lookAway(): void {
    this.#assertReady()
    this.#clearGazeTarget()
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping
    try {
      this.#assertReady()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#haltQueue()
  }

  close(): Promise<void> {
    if (!this.#shutdown) {
      this.#closed = true
      this.#shutdown = new OwnedResources([
        // Bus commands have bounded physical completion; do not release their driver early.
        () =>
          this.#maintenance?.then(
            () => {},
            () => {},
          ),
        () => this.#haltQueue(),
        () => this.#relax(),
        () => {
          if (!this.#attached) return
          this.#attached = false
          this.#driver.onDetached?.()
        },
      ])
    }
    return this.#shutdown.close()
  }

  relax(): Promise<void> {
    try {
      if (this.#closed) throw new StackchanError('CLOSED', 'App motion is closed')
      if (this.#maintaining) throw new StackchanError('BUSY', 'Servo maintenance is in progress')
      if (this.#stopping) throw new StackchanError('BUSY', 'Motion is stopping')
      if (!this.#canRelax) throw new StackchanError('UNSUPPORTED', 'This driver cannot release torque')
      return this.#haltQueue(true)
    } catch (error) {
      return Promise.reject(asStackchanError(error))
    }
  }

  #run(target: MotionTarget, options: MotionOptions, source = new CancellationSource()): Promise<MotionResult> {
    let execution: MotionExecution | undefined
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = options.signal?.subscribe((reason) => source.cancel(reason))
    } catch (error) {
      return Promise.reject(asStackchanError(error))
    }
    return this.#queue
      .run(
        () =>
          new Promise<MotionResult>((resolve) => {
            execution = new MotionExecution({
              port: this.#driver.motion,
              clock: this.#options.clock,
              target: { y: (target.yawDeg * Math.PI) / 180, p: (target.pitchDeg * Math.PI) / 180, r: 0 },
              durationMs: options.durationMs,
              timeoutMs: options.timeoutMs ?? options.durationMs + 5_000,
              onPosition: this.#options.onPosition,
              onDone: resolve,
              onError: (error) => source.cancel(error),
            })
            execution.start()
          }),
        () => execution?.stop(),
        source.signal,
      )
      .finally(() => unsubscribe?.())
  }

  #scheduleGaze(): void {
    if (
      this.#closed ||
      this.#queue.closed ||
      this.#stopping ||
      this.#failure ||
      this.#foreground ||
      this.#gazeSource ||
      this.#clearGaze ||
      !this.#gaze ||
      this.#appliedGazeVersion === this.#gazeVersion
    )
      return
    try {
      this.#clearGaze = this.#options.clock.after(0, () => {
        this.#clearGaze = undefined
        if (this.#closed || this.#queue.closed || this.#stopping || this.#foreground || !this.#gaze) return
        const version = this.#gazeVersion
        const source = new CancellationSource()
        this.#gazeSource = source
        void this.#run(this.#gaze, { durationMs: 500 }, source)
          .then(
            () => {
              if (this.#foreground === 0 && !source.signal.reason) this.#appliedGazeVersion = version
            },
            (error) => {
              if (error.code !== 'CANCELLED' && error.code !== 'CLOSED') {
                // A failed background movement must not become an automatic retry loop.
                if (this.#gazeVersion === version) {
                  this.#gaze = undefined
                  this.#gazePoint = null
                }
                this.#report(asStackchanError(error))
              }
            },
          )
          .finally(() => {
            this.#gazeSource = undefined
            this.#scheduleGaze()
          })
      })
    } catch (error) {
      this.#gaze = undefined
      this.#gazePoint = null
      this.#report(asStackchanError(error))
    }
  }

  #haltQueue(relax = false): Promise<void> {
    this.#clearGazeTarget()
    if (this.#stopping) return this.#stopping
    this.#stopping = Promise.resolve()
      .then(() =>
        new OwnedResources([
          () => this.#queue.close(new StackchanError(this.#closed ? 'CLOSED' : 'CANCELLED', 'Motion owner stopped')),
          // A fault can prevent holding position. Still attempt torque release,
          // preserving the first failure and leaving the queue unavailable.
          () => (relax ? this.#relax() : undefined),
        ]).close(),
      )
      .then(
        () => {
          if (!this.#closed) this.#queue = new OperationQueue({ clock: this.#options.clock })
        },
        (error) => {
          this.#failure = asStackchanError(error)
          throw this.#failure
        },
      )
      .finally(() => {
        this.#stopping = undefined
      })
    return this.#stopping
  }

  #clearGazeTarget(): void {
    this.#gaze = undefined
    this.#gazePoint = null
    this.#gazeSource?.cancel()
    this.#cancelGazeTimer()
  }

  #cancelGazeTimer(): void {
    this.#clearGaze?.()
    this.#clearGaze = undefined
  }

  #relax(): Promise<void> | undefined {
    if (!this.#attached || !this.#canRelax) return
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let clear: (() => void) | undefined
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clear?.()
        if (error != null) reject(asStackchanError(error))
        else resolve()
      }
      try {
        clear = this.#options.clock.after(2_000, () =>
          finish(new StackchanError('TIMEOUT', 'Motion power release timed out')),
        )
        this.#driver.setTorque(false, finish)
      } catch (error) {
        finish(asStackchanError(error))
      }
    })
  }

  #assertReady(): void {
    if (this.#maintaining) throw new StackchanError('BUSY', 'Servo maintenance is running')
    if (this.#closed) throw new StackchanError('CLOSED', 'App motion is closed')
    if (this.#failure) throw this.#failure
    if (this.#stopping) throw new StackchanError('BUSY', 'Motion is stopping')
    if (this.#queue.closed) throw new StackchanError('CLOSED', 'Motion requires host restart after a failed stop')
    const info = this.info
    if (info.availability === 'unavailable') throw new StackchanError('UNSUPPORTED', info.reason)
  }

  #validateTarget(target: MotionTarget): MotionTarget {
    if (!target || typeof target !== 'object')
      throw new StackchanError('INVALID_ARGUMENT', 'A motion target is required')
    const info = this.info
    if (info.availability === 'unavailable') throw new StackchanError('UNSUPPORTED', info.reason)
    finiteNumber(target.yawDeg, 'yawDeg', info.yawDeg[0], info.yawDeg[1])
    finiteNumber(target.pitchDeg, 'pitchDeg', info.pitchDeg[0], info.pitchDeg[1])
    return { yawDeg: target.yawDeg, pitchDeg: target.pitchDeg }
  }

  #validateOptions(options: MotionOptions): void {
    if (!options) throw new StackchanError('INVALID_ARGUMENT', 'Motion requires durationMs')
    finiteNumber(options.durationMs, 'durationMs', 0, 60_000)
    if (options.timeoutMs !== undefined) finiteNumber(options.timeoutMs, 'timeoutMs', 1, 120_000)
    if (options.completion !== undefined && options.completion !== 'trajectory' && options.completion !== 'measured')
      throw new StackchanError('INVALID_ARGUMENT', 'Unknown motion completion mode')
    if (
      options.completion === 'measured' &&
      (this.info.availability === 'unavailable' || this.info.feedback !== 'measured')
    )
      throw new StackchanError('UNSUPPORTED', 'This motion driver cannot confirm measured arrival')
  }

  #report(error: StackchanError): void {
    try {
      this.#options.onError(error)
    } catch {
      /* Observers cannot own motion. */
    }
  }
}
