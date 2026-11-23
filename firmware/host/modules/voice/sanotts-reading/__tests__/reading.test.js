import { toKana } from 'stackchan/voice/sanotts-reading'
import { assert, equal } from 'testing/assert'

const plain = (s) => toKana(s).replaceAll(']', '')
equal(plain('世界、猫？'), 'せかい_ねこ?')
equal(plain('カメラ'), 'かめら')
equal(plain('42'), 'よんに')
equal(plain(''), '')
for (const text of ['電車', '猫🛸', 'a\0b', '猫'.repeat(1600)]) {
  let error
  try {
    toKana(text)
  } catch (cause) {
    error = cause
  }
  assert(error instanceof RangeError)
}
equal(plain('音声'), 'おんせー')
let invalid
try {
  toKana({ includes: () => false, toString: () => '猫' })
} catch (cause) {
  invalid = cause
}
assert(invalid instanceof TypeError)
trace('@@STACKCHAN_TEST:PASS@@\n')
