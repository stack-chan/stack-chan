let ticks = 0
let timezone = 0
let dst = 0

const Time = {
  get ticks(): number {
    return ticks
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
