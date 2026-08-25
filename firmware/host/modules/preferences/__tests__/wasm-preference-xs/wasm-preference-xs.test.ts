import Preference from 'preference'
import { assert, equal } from 'testing/assert'

function expectThrow(callback: () => void, expectedMessage: string): void {
  let caught: unknown
  try {
    callback()
  } catch (error) {
    caught = error
  }
  assert(caught instanceof Error, `expected an error containing ${expectedMessage}`)
  assert(String(caught).includes(expectedMessage), `expected ${String(caught)} to contain ${expectedMessage}`)
}

const buffer = new ArrayBuffer(4)
new Uint8Array(buffer).set([1, 2, 3, 4])
const supportedValues = [true, 42, '0.46', buffer] as const

for (let index = 0; index < supportedValues.length; index += 1) {
  const key = `supported-${index}`
  const value = supportedValues[index]
  Preference.set('test', key, value)
  const stored = Preference.get('test', key)
  if (value instanceof ArrayBuffer) {
    assert(stored instanceof ArrayBuffer, 'stored buffer should remain an ArrayBuffer')
    const actualBytes = new Uint8Array(stored as ArrayBuffer)
    const expectedBytes = new Uint8Array(value)
    equal(actualBytes.length, expectedBytes.length, 'stored buffer length should match')
    for (let byteIndex = 0; byteIndex < expectedBytes.length; byteIndex += 1) {
      equal(actualBytes[byteIndex], expectedBytes[byteIndex], `stored byte ${byteIndex} should match`)
    }
  } else {
    equal(stored, value, `stored ${typeof value} should match`)
  }
  Preference.delete('test', key)
}

Preference.set('test', 'volume', 'previous')
expectThrow(() => Preference.set('test', 'volume', 0.46), 'float unsupported')
equal(Preference.get('test', 'volume'), 'previous', 'a rejected float should preserve the existing value')
Preference.delete('test', 'volume')

Preference.set('test', 'object', 'previous')
expectThrow(() => Preference.set('test', 'object', {}), 'unsupported type')
equal(Preference.get('test', 'object'), 'previous', 'a rejected object should preserve the existing value')
Preference.delete('test', 'object')

trace('ok\n')
