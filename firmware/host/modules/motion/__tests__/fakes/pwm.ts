export const writes: number[] = []
export const channels: PWM[] = []

export default class PWM {
  readonly resolution = 12
  closed = false
  constructor(_options: unknown) {
    channels.push(this)
  }
  write(value: number): void {
    if (this.closed) throw new Error('PWM channel is closed')
    if (!Number.isFinite(value)) throw new Error('PWM value is not finite')
    writes.push(value)
  }
  close(): void {
    this.closed = true
  }
}
