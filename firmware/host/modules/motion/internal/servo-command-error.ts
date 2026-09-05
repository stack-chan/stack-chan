export { CommandTimeoutError } from 'servo-bus'

export function isCommandTimeoutReason(reason: string | undefined): boolean {
  return reason === undefined ? false : reason.indexOf('command timed out') >= 0
}
