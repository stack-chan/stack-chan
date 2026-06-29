export type IMUVector3 = {
  x: number
  y: number
  z: number
}

export type IMUSample = {
  accelerometer?: IMUVector3
  gyroscope?: IMUVector3
}

export type MotionType = 'shake' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'

export type IMUMotion = {
  type: MotionType
  sample: IMUSample
  ticks: number
}

export type MotionRecognizerOptions = {
  accelerationDeltaThreshold?: number
  gyroscopeThreshold?: number
  detectGyroscopeShake?: boolean
  consecutiveSamples?: number
  refractoryMs?: number
  postureThreshold?: number
  postureConsecutiveSamples?: number
}

type Posture = 'unknown' | 'upright' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'

export class MotionRecognizer {
  #previousAccelerationMagnitude: number | undefined
  #motionSampleCount = 0
  #lastMotionTicks = -Infinity
  #currentPosture: Posture = 'unknown'
  #candidatePosture: Posture = 'unknown'
  #postureSampleCount = 0
  #accelerationDeltaThreshold: number
  #gyroscopeThreshold: number
  #detectGyroscopeShake: boolean
  #consecutiveSamples: number
  #refractoryMs: number
  #postureThreshold: number
  #postureConsecutiveSamples: number

  constructor(options: MotionRecognizerOptions = {}) {
    this.#accelerationDeltaThreshold = options.accelerationDeltaThreshold ?? 1.2
    this.#gyroscopeThreshold = options.gyroscopeThreshold ?? 3
    this.#detectGyroscopeShake = options.detectGyroscopeShake ?? false
    this.#consecutiveSamples = options.consecutiveSamples ?? 10
    this.#refractoryMs = options.refractoryMs ?? 1500
    this.#postureThreshold = options.postureThreshold ?? 0.75
    this.#postureConsecutiveSamples = options.postureConsecutiveSamples ?? 3
  }

  reset(): void {
    this.#previousAccelerationMagnitude = undefined
    this.#motionSampleCount = 0
    this.#lastMotionTicks = -Infinity
    this.#currentPosture = 'unknown'
    this.#candidatePosture = 'unknown'
    this.#postureSampleCount = 0
  }

  update(sample: IMUSample, ticks: number): IMUMotion | undefined {
    const accelerationMagnitude = sample.accelerometer ? magnitude(sample.accelerometer) : undefined
    const gyroscopeMagnitude = sample.gyroscope ? magnitude(sample.gyroscope) : undefined

    const accelerationDelta =
      accelerationMagnitude !== undefined && this.#previousAccelerationMagnitude !== undefined
        ? Math.abs(accelerationMagnitude - this.#previousAccelerationMagnitude)
        : 0
    if (accelerationMagnitude !== undefined) {
      this.#previousAccelerationMagnitude = accelerationMagnitude
    }

    const isMoving =
      accelerationDelta >= this.#accelerationDeltaThreshold ||
      (this.#detectGyroscopeShake && gyroscopeMagnitude !== undefined && gyroscopeMagnitude >= this.#gyroscopeThreshold)

    this.#motionSampleCount = isMoving ? this.#motionSampleCount + 1 : 0
    if (!isMoving || this.#motionSampleCount < this.#consecutiveSamples) return this.#updatePosture(sample, ticks)
    if (ticks - this.#lastMotionTicks < this.#refractoryMs) return this.#updatePosture(sample, ticks)

    this.#lastMotionTicks = ticks
    this.#motionSampleCount = 0
    return { type: 'shake', sample: copySample(sample), ticks }
  }

  #updatePosture(sample: IMUSample, ticks: number): IMUMotion | undefined {
    const posture = detectPosture(sample.accelerometer, this.#postureThreshold)
    if (posture === undefined) return undefined

    if (posture !== this.#candidatePosture) {
      this.#candidatePosture = posture
      this.#postureSampleCount = 0
    }

    this.#postureSampleCount += 1
    if (this.#postureSampleCount < this.#postureConsecutiveSamples) return undefined
    if (posture === this.#currentPosture) return undefined

    this.#currentPosture = posture
    if (posture === 'upright' || posture === 'unknown') return undefined

    return { type: posture, sample: copySample(sample), ticks }
  }
}

export function magnitude(vector: IMUVector3): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
}

function detectPosture(accelerometer: IMUVector3 | undefined, threshold: number): Posture | undefined {
  if (!accelerometer) return undefined

  const accelerationMagnitude = magnitude(accelerometer)
  if (accelerationMagnitude === 0) return 'unknown'

  const x = accelerometer.x / accelerationMagnitude
  const y = accelerometer.y / accelerationMagnitude
  const z = accelerometer.z / accelerationMagnitude

  if (y >= threshold) return 'upright'
  if (y <= -threshold) return 'upsideDown'
  if (Math.abs(x) >= Math.abs(z) && Math.abs(x) >= threshold) return x >= 0 ? 'fallenLeft' : 'fallenRight'
  if (Math.abs(z) >= threshold) return z < 0 ? 'fallenForward' : 'fallenBackward'
  return 'unknown'
}

function copySample(sample: IMUSample): IMUSample {
  return {
    ...(sample.accelerometer && { accelerometer: { ...sample.accelerometer } }),
    ...(sample.gyroscope && { gyroscope: { ...sample.gyroscope } }),
  }
}
