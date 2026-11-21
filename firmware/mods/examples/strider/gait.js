const CIRCLE = 1152
const TURN_HALF_WIDTH = 144
const TURN_POWER = 1
const MAX_POSITION_SPEED = 1400
const POSITION_RESPONSE_SECONDS = 0.07
const CALIBRATION_POWER = 0.6
const CALIBRATION_LEG_MS = 8000
const CALIBRATION_SETTLE_MS = 600
const MIN_CALIBRATION_SAMPLES = 120
const MIN_GYRO_AMPLITUDE = 0.5
const REFERENCE_PITCH_PEAK = 418
const REFERENCE_YAW_PEAK = 246
const REFERENCE_RIGHT_CENTER = 668

function wrap(value, period) {
  return value - period * Math.floor(value / period)
}

function signedOffset(value, center) {
  const difference = value - center
  return difference - CIRCLE * Math.round(difference / CIRCLE)
}

export function isTurnCenter(value) {
  return Number.isInteger(value) && value >= 0 && value < CIRCLE
}

function readable(position) {
  return position > 10 && position < 1015
}

class PositionEstimate {
  #position
  #previousRaw
  #previousMs
  #velocity = 0
  #mismatches = 0

  update(raw, elapsedMs, power) {
    const delta = (elapsedMs - this.#previousMs) / 1000
    const previousRaw = this.#previousRaw
    this.#previousRaw = raw
    this.#previousMs = elapsedMs
    if (this.#position === undefined) {
      this.#position = raw
      return this.#position
    }
    if (delta <= 0) return this.#position

    this.#velocity += (-power * MAX_POSITION_SPEED - this.#velocity) * Math.min(1, delta / POSITION_RESPONSE_SECONDS)
    const predicted = this.#position + this.#velocity * delta
    const candidate = predicted + signedOffset(raw, predicted)
    const valid = readable(raw)
    const consistent = valid && Math.abs(candidate - predicted) < 120
    const leavingBlindZone =
      valid &&
      ((previousRaw <= 10 && raw < 80 && this.#velocity > 0) ||
        (previousRaw >= 1015 && raw > 950 && this.#velocity < 0))
    const wrapped = wrap(predicted, CIRCLE)
    const smooth = valid && Math.abs(raw - previousRaw) < 60
    this.#mismatches =
      !consistent && !leavingBlindZone && smooth && wrapped > 150 && wrapped < 900 ? this.#mismatches + 1 : 0

    if (consistent || leavingBlindZone) {
      this.#velocity = (this.#velocity + (candidate - this.#position) / delta) / 2
      this.#position = candidate
    } else if (this.#mismatches >= 10) {
      this.#mismatches = 0
      this.#position = candidate
    } else {
      this.#position = predicted
    }
    return this.#position
  }
}

export class TurningGait {
  #center
  #estimate = new PositionEstimate()
  #direction = 0

  constructor(center, action) {
    this.#center = center + (action === 'left' ? CIRCLE / 2 : 0)
  }

  advance(raw, elapsedMs) {
    const estimate = this.#estimate.update(raw, elapsedMs, this.#direction * TURN_POWER)
    const offset = signedOffset(estimate, this.#center)
    if (this.#direction === 0) {
      this.#direction = offset < -TURN_HALF_WIDTH ? -1 : 1
    } else if (this.#direction > 0 && offset <= -TURN_HALF_WIDTH) {
      this.#direction = -1
    } else if (this.#direction < 0 && offset >= TURN_HALF_WIDTH) {
      this.#direction = 1
    }
    return this.#direction * TURN_POWER
  }
}

function solveFive(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < 5; column++) {
    let pivot = column
    for (let index = column + 1; index < 5; index++) {
      if (Math.abs(rows[index][column]) > Math.abs(rows[pivot][column])) pivot = index
    }
    if (Math.abs(rows[pivot][column]) < 1e-9) return undefined
    const swap = rows[column]
    rows[column] = rows[pivot]
    rows[pivot] = swap
    for (let index = column + 1; index < 5; index++) {
      const factor = rows[index][column] / rows[column][column]
      for (let entry = column; entry <= 5; entry++) rows[index][entry] -= factor * rows[column][entry]
    }
  }
  const solution = Array(5).fill(0)
  for (let index = 4; index >= 0; index--) {
    let value = rows[index][5]
    for (let entry = index + 1; entry < 5; entry++) value -= rows[index][entry] * solution[entry]
    solution[index] = value / rows[index][index]
  }
  return solution
}

class CalibrationFit {
  #positionMatrix = Array.from({ length: 5 }, () => Array(5).fill(0))
  #pitchData = Array(5).fill(0)
  #yawData = Array(5).fill(0)
  #sampleCount = 0
  #phaseBins = 0

  add(position, gyro) {
    const angle = (2 * Math.PI * position) / CIRCLE
    const basis = [1, Math.cos(angle), Math.sin(angle), Math.cos(2 * angle), Math.sin(2 * angle)]
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) this.#positionMatrix[row][col] += basis[row] * basis[col]
      this.#pitchData[row] += basis[row] * gyro.x
      this.#yawData[row] += basis[row] * gyro.y
    }
    this.#sampleCount++
    this.#phaseBins |= 1 << Math.floor(position / 128)
  }

  rightCenter() {
    if (this.#sampleCount < MIN_CALIBRATION_SAMPLES || this.#phaseBins !== 0xff) return undefined
    const pitch = solveFive(this.#positionMatrix, this.#pitchData)
    const yaw = solveFive(this.#positionMatrix, this.#yawData)
    if (
      !pitch ||
      !yaw ||
      Math.hypot(pitch[3], pitch[4]) < MIN_GYRO_AMPLITUDE ||
      Math.hypot(yaw[1], yaw[2]) < MIN_GYRO_AMPLITUDE
    ) {
      return undefined
    }
    const pitchPeak = (Math.atan2(pitch[4], pitch[3]) * CIRCLE) / (4 * Math.PI)
    const yawPeak = (Math.atan2(yaw[2], yaw[1]) * CIRCLE) / (2 * Math.PI)
    const shift = wrap(pitchPeak - REFERENCE_PITCH_PEAK, CIRCLE / 2)
    const otherShift = shift + CIRCLE / 2
    const firstError = Math.abs(signedOffset(yawPeak, REFERENCE_YAW_PEAK + shift))
    const secondError = Math.abs(signedOffset(yawPeak, REFERENCE_YAW_PEAK + otherShift))
    return wrap(Math.round(REFERENCE_RIGHT_CENTER + (firstError <= secondError ? shift : otherShift)), CIRCLE)
  }
}

export class CalibrationGait {
  /** @type {{ name: 'measuring'; fit: CalibrationFit; previousRaw?: number } | { name: 'returning'; startedAt: number; center?: number }} */
  #phase = { name: 'measuring', fit: new CalibrationFit(), previousRaw: undefined }

  get needsSample() {
    return this.#phase.name === 'measuring'
  }

  advance(elapsedMs, position, gyro) {
    const phase = this.#phase
    if (phase.name === 'returning') {
      return elapsedMs - phase.startedAt >= CALIBRATION_LEG_MS
        ? { center: phase.center }
        : { power: -CALIBRATION_POWER }
    }
    if (elapsedMs >= CALIBRATION_LEG_MS) {
      this.#phase = { name: 'returning', startedAt: elapsedMs, center: phase.fit.rightCenter() }
      return { power: -CALIBRATION_POWER }
    }
    if (
      elapsedMs >= CALIBRATION_SETTLE_MS &&
      readable(position) &&
      Math.abs(position - phase.previousRaw) < 100 &&
      gyro &&
      Number.isFinite(gyro.x) &&
      Number.isFinite(gyro.y)
    ) {
      phase.fit.add(position, gyro)
    }
    phase.previousRaw = position
    return { power: CALIBRATION_POWER }
  }
}
