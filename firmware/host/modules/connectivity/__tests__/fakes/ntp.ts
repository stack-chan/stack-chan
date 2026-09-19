type Callback = (error: unknown, value?: number) => void
export default class NTP {
  static nextTime = 1_700_000_000_000
  static instances: NTP[] = []
  callback?: Callback
  closed = false
  constructor(readonly options: { servers: string[]; socket: object; dns: object }) {
    NTP.instances.push(this)
  }
  getTime(callback: Callback) {
    this.callback = callback
  }
  close() {
    this.closed = true
  }
  respond(error: unknown = null, value: number = NTP.nextTime) {
    this.callback?.(error, value)
  }
}
/** Discard clients recorded by the previous test without changing the fake clock. */
export function resetNTP() {
  NTP.instances = []
}
