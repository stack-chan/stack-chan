import assert from 'node:assert/strict'
import test from 'node:test'

import { LatestTrackingSender } from './latest-sender.mjs'

test('sender keeps only the newest tracking state while an ACK is pending', async () => {
  const calls = []
  let acknowledge
  const session = {
    send(peerId, type, payload) {
      calls.push({ peerId, type, payload })
      return new Promise((resolve) => {
        acknowledge = resolve
      })
    },
  }
  const sender = new LatestTrackingSender(session, 'AABBCCDDEEFF')
  sender.queue({ version: 1, sequence: 1 })
  const first = sender.flush()
  sender.queue({ version: 1, sequence: 2 })
  sender.queue({ version: 1, sequence: 3 })
  assert.equal(await sender.flush(), false)
  acknowledge()
  assert.equal(await first, true)
  const second = sender.flush()
  assert.equal(calls[1].payload.sequence, 3)
  acknowledge()
  assert.equal(await second, true)
  assert.equal(calls[0].type, 'tracking.update')
})
