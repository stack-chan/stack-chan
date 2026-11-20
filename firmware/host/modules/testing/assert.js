export function assert(condition, message = 'assertion failed') {
  if (!condition) {
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    trace(`${message}\n`)
    throw new Error(message)
  }
}

export function equal(actual, expected, message = 'assertion failed') {
  if (actual !== expected) {
    const detail = `${message}: expected ${expected} but got ${actual}`
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    trace(`${detail}\n`)
    throw new Error(detail)
  }
}
