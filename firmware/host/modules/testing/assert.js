export function assert(condition, message = 'assertion failed') {
  if (!condition) {
    trace(`${message}\n`)
    throw new Error(message)
  }
}

export function equal(actual, expected, message = 'assertion failed') {
  if (actual !== expected) {
    const detail = `${message}: expected ${expected} but got ${actual}`
    trace(`${detail}\n`)
    throw new Error(detail)
  }
}
