// UI tests observe the same mutable object before and after events. Do not keep
// TypeScript's assertion narrowing across those event-driven state changes.
export function assert(condition: unknown, message = 'assertion failed'): void {
  if (!condition) {
    trace(`${message}\n`)
    throw new Error(message)
  }
}

export function equal(actual: unknown, expected: unknown, message = 'assertion failed'): void {
  if (actual !== expected) {
    const detail = `${message}: expected ${expected} but got ${actual}`
    trace(`${detail}\n`)
    throw new Error(detail)
  }
}
