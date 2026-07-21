import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUsbAudioCaption, usbAudioMouthStep } from './usb-audio-presentation-model.js'

test('USB audio captions retain at most the latest two display lines', () => {
  assert.equal(formatUsbAudioCaption('ABCDEF', 52), 'CD\nEF')
  assert.equal(formatUsbAudioCaption('first\nsecond\nthird', 320), 'second\nthird')
  assert.equal(formatUsbAudioCaption('  hello  ', 320), 'hello')
})

test('USB audio mouth power is quantized to 0.1 steps', () => {
  assert.equal(usbAudioMouthStep(Number.NaN), 0)
  assert.equal(usbAudioMouthStep(-1), 0)
  assert.equal(usbAudioMouthStep(100), 1)
  assert.equal(usbAudioMouthStep(1000), 5)
  assert.equal(usbAudioMouthStep(2000), 10)
  assert.equal(usbAudioMouthStep(4000), 10)
})
