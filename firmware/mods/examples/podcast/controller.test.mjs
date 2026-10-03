import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PodcastController } from './controller.js'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
test('artwork follows selection, rejects stale results and falls back to show image', async () => {
  const requests = []
  const context = { audio: { media: { stop() {} } }, ui: {} }
  const episodes = [
    { identity: 'a', artwork: 'a.jpg' },
    { identity: 'b', artwork: 'b.jpg' },
  ]
  const controller = new PodcastController(
    context,
    [{ url: 'feed' }],
    () => ({ promise: Promise.resolve({ episodes, artwork: 'show.jpg' }), cancel() {} }),
    { hide() {} },
    (url) => {
      const request = {
        url,
        cancelled: false,
        cancel() {
          this.cancelled = true
        },
      }
      request.promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }))
      requests.push(request)
      return request
    },
  )
  await controller.refresh()
  assert.equal(requests[0].url, 'a.jpg')
  controller.selectEpisode(1)
  assert.equal(requests[0].cancelled, true)
  requests[0].resolve('stale')
  await flush()
  assert.equal(controller.snapshot.artwork, undefined)
  requests[1].reject(new Error('not JPEG'))
  await flush()
  assert.equal(requests[2].url, 'show.jpg')
  requests[2].resolve('bitmap')
  await flush()
  assert.equal(controller.snapshot.artwork, 'bitmap')
  let state
  const unsubscribe = controller.subscribe((value) => {
    state = value
  })
  unsubscribe()
  controller.stop()
  controller.subscribe((value) => {
    state = value
  })()
  assert.equal(state.artwork, 'bitmap', 'closing UI and stopping audio retain selected artwork')
  controller.selectEpisode(0)
  assert.equal(controller.snapshot.artwork, undefined)
  controller.close()
  assert.equal(requests[3].cancelled, true)
  requests[3].resolve('late')
  await flush()
  assert.equal(controller.snapshot.artwork, undefined)
})

test('RSS failures belong to episode state and clear on retry', async () => {
  let fail = true
  const controller = new PodcastController(
    { audio: { media: { stop() {} } }, ui: {} },
    [{ title: 'show', url: 'feed' }],
    () => ({
      promise: fail
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ title: 'show', episodes: [], limited: true }),
      cancel() {},
    }),
    { hide() {} },
  )
  await controller.refresh()
  assert.equal(controller.snapshot.feedError, 'podcast.feedFailed')
  assert.equal(controller.snapshot.loading, false)
  assert.equal(controller.snapshot.artEnabled, false)
  fail = false
  await controller.refresh()
  assert.equal(controller.snapshot.feedError, undefined)
  assert.equal(controller.snapshot.loading, false)
  controller.close()
})
