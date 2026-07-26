import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { UsbEventSendRequests } = await import('./event-send-requests.js')

test('worker EVENT send requests resolve only their correlated Promise', async () => {
  const requests = new UsbEventSendRequests()
  const first = requests.begin()
  const second = requests.begin()

  assert.notEqual(first.requestId, second.requestId)
  assert.equal(requests.resolve(second.requestId, 'queued'), true)
  assert.equal(requests.resolve(99_999, 'queued'), false)
  requests.resolve(first.requestId, 'unsupported')

  assert.equal(await first.result, 'unsupported')
  assert.equal(await second.result, 'queued')
})

test('worker EVENT send requests surface bounded queue overflow', async () => {
  const requests = new UsbEventSendRequests()
  const request = requests.begin()

  assert.equal(requests.resolve(request.requestId, 'overflow'), true)
  assert.equal(await request.result, 'overflow')
})

test('closing the bridge settles every pending EVENT send as disconnected', async () => {
  const requests = new UsbEventSendRequests()
  const first = requests.begin()
  const second = requests.begin()

  requests.settleAll('disconnected')

  assert.equal(await first.result, 'disconnected')
  assert.equal(await second.result, 'disconnected')
})

test('worker EVENT failures reject the matching request', async () => {
  const requests = new UsbEventSendRequests()
  const request = requests.begin()

  assert.equal(requests.reject(request.requestId, new Error('encoding failed')), true)
  await assert.rejects(request.result, /encoding failed/)
})
