let ticks = 0

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
  reset(): void {
    ticks = 0
  },
}

export default Time
