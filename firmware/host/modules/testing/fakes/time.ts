let ticks = 0
let timezone = 0
let dst = 0

const Time = {
  get ticks(): number {
    return ticks
  },
  delta(start: number, end = ticks): number {
    // Model ESP32's signed result from unsigned 32-bit tick subtraction.
    return ((end >>> 0) - (start >>> 0)) | 0
  },
  set(value: number): void {
    ticks = value
  },
  setTicks(value: number): void {
    ticks = value
  },
  get timezone(): number {
    return timezone
  },
  set timezone(value: number) {
    timezone = value
  },
  get dst(): number {
    return dst
  },
  set dst(value: number) {
    dst = value
  },
  reset(): void {
    ticks = 0
    timezone = 0
    dst = 0
  },
}

export default Time
