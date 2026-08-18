import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CoreS3I2SBus } from '../platforms/m5stackchan-cores3/cores3-i2s-bus.ts'

test('acquiring the other role stops the previous codec before starting the next', () => {
  const events: string[] = []
  const bus = new CoreS3I2SBus({
    startSpeaker: (sampleRate) => events.push(`startSpeaker:${sampleRate}`),
    stopSpeaker: () => events.push('stopSpeaker'),
    startMicrophone: (sampleRate) => events.push(`startMicrophone:${sampleRate}`),
    stopMicrophone: () => events.push('stopMicrophone'),
  })

  bus.acquire('microphone', 16000)
  bus.acquire('speaker', 24000)

  assert.equal(bus.owner, 'speaker')
  assert.deepEqual(events, ['startMicrophone:16000', 'stopMicrophone', 'startSpeaker:24000'])
})

test('release only stops the current owner', () => {
  const events: string[] = []
  const bus = new CoreS3I2SBus({
    startSpeaker: () => events.push('startSpeaker'),
    stopSpeaker: () => events.push('stopSpeaker'),
    startMicrophone: () => events.push('startMicrophone'),
    stopMicrophone: () => events.push('stopMicrophone'),
  })

  bus.acquire('speaker', 24000)
  bus.release('microphone')
  assert.equal(bus.owner, 'speaker')
  bus.release('speaker')
  assert.equal(bus.owner, 'idle')
  assert.deepEqual(events, ['startSpeaker', 'stopSpeaker'])
})
