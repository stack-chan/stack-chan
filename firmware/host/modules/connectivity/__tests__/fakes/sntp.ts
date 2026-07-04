type SNTPCallback = (message: number, value?: number) => void

export default class SNTP {
  static readonly time = 1
  static readonly error = -1
  static nextTime = 1_700_000_000
  static requests: Array<{ host?: string }> = []

  constructor(options: { host?: string }, callback: SNTPCallback) {
    SNTP.requests.push(options)
    callback(SNTP.time, SNTP.nextTime)
  }
}

export function resetSNTP(): void {
  SNTP.nextTime = 1_700_000_000
  SNTP.requests = []
}
