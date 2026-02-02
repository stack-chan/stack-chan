export function assert(condition, message = 'assertion failed') {
  if (!condition) {
    throw new Error(message)
  }
}

export function equal(actual, expected, message = 'assertion failed') {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected} but got ${actual}`)
  }
}
