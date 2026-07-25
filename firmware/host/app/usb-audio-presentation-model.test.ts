import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatUsbAudioCaption,
  usbAudioConversationState,
  usbAudioMouthStep,
  usbAudioStatusVisual,
} from './usb-audio-presentation-model.js'
import { StackChanStatus } from '../modules/usb-audio/protocol.js'

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

test('USB audio status maps every negotiated state to a distinct presentation', () => {
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.IDLE), {
    kind: 'hidden',
  })
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.RECOGNIZING), {
    kind: 'spinner',
    color: 'white',
  })
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.SPEAKING), {
    kind: 'microphone',
    muted: true,
  })
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.LISTENING), {
    kind: 'microphone',
    muted: false,
  })
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.CONNECTING), {
    kind: 'spinner',
    color: 'amber',
  })
  assert.deepEqual(usbAudioStatusVisual(StackChanStatus.ERROR), {
    kind: 'error',
  })
})

test('USB audio status maps to the public remote conversation state', () => {
  assert.equal(usbAudioConversationState(StackChanStatus.IDLE), 'standby')
  assert.equal(usbAudioConversationState(StackChanStatus.RECOGNIZING), 'recognizing')
  assert.equal(usbAudioConversationState(StackChanStatus.SPEAKING), 'speaking')
  assert.equal(usbAudioConversationState(StackChanStatus.LISTENING), 'listening')
  assert.equal(usbAudioConversationState(StackChanStatus.CONNECTING), 'connecting')
  assert.equal(usbAudioConversationState(StackChanStatus.ERROR), 'blocked')
})
