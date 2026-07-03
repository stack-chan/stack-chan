export class CommandTimeoutError extends Error {
  protocol: string
  timeoutMs: number

  constructor(protocol: string, timeoutMs: number) {
    super(`${protocol} command timed out after ${timeoutMs}ms`)
    this.name = 'CommandTimeoutError'
    this.protocol = protocol
    this.timeoutMs = timeoutMs
  }
}

export function isCommandTimeoutReason(reason: string | undefined): boolean {
  return reason === undefined ? false : reason.indexOf('command timed out') >= 0
}
