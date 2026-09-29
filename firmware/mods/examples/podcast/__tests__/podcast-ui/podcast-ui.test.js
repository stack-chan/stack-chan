import { Application } from 'piu/MC'
import { createPodcastView } from 'podcast-view'
import { assert, equal } from 'testing/assert'

let listener,
  stops = 0,
  plays = 0,
  pauses = 0,
  seeks = [],
  refreshes = 0
const model = {
  snapshot: {
    feeds: [{ title: 'A' }, { title: 'B' }],
    feedIndex: 0,
    episodes: Array.from({ length: 8 }, (_, i) => ({
      title: `Episode ${i} with a long title to wrap in the selection list`,
    })),
    episodeIndex: 0,
    progress: { position: 0, duration: 120, estimated: false, seekable: true },
    state: 'idle',
    status: '停止中',
    loading: false,
  },
  subscribe(callback) {
    listener = callback
    callback(this.snapshot)
    return () => {
      listener = undefined
    }
  },
  selectFeed(index) {
    this.snapshot.feedIndex = index
    listener?.(this.snapshot)
  },
  selectEpisode(index) {
    this.snapshot.episodeIndex = index
    listener?.(this.snapshot)
  },
  play() {
    plays++
    this.snapshot.state = 'playing'
    this.snapshot.status = '再生中'
    listener?.(this.snapshot)
  },
  pause() {
    pauses++
    this.snapshot.state = 'paused'
    listener?.(this.snapshot)
  },
  seek(seconds) {
    seeks.push(seconds)
  },
  stop() {
    stops++
    this.snapshot.state = 'idle'
    listener?.(this.snapshot)
  },
  refresh() {
    refreshes++
    this.snapshot.loading = true
    listener?.(this.snapshot)
  },
}
const dimensions = { width: 320, height: 196, close() {} }
let view = createPodcastView(model, dimensions)
const app = new Application(null, { displayListLength: 4096, contents: [view.content] })
function named(name) {
  for (let node = view.content.first; node; node = node.next) if (node.name === name) return node
  throw new Error(`missing ${name}`)
}
function tap(name) {
  const node = named(name)
  assert(node.active, `${name} enabled`)
  const x = node.x + 8,
    y = node.y + 8
  node.behavior.onTouchBegan(node, 0, x, y)
  node.behavior.onTouchEnded(node, 0, x, y)
}
// Force layout through coordinate access, and check relational bounds at the host viewport size.
assert(named('status').y + named('status').height <= named('play').y, 'status must not cover controls')
assert(named('refresh').x + named('refresh').width <= view.content.x + dimensions.width, 'actions fit viewport')
tap('episode')
assert(!named('previous').active)
tap('next')
tap('item:4')
equal(model.snapshot.episodeIndex, 4)
equal(plays, 0, 'selection does not autoplay')
tap('feed')
tap('item:1')
equal(model.snapshot.feedIndex, 1)
tap('play')
equal(plays, 1)
assert(named('play').active)
equal(named('status').string, '再生中')
tap('play')
equal(pauses, 1)
equal(model.snapshot.state, 'paused')
tap('play')
equal(plays, 2)
const bar = named('seek')
// Enter through Piu: calling only onTouchMoved bypasses captureTouch and its native argument contract.
screen.context.onTouchBegan(0, bar.x + 8, bar.y + 15, 100)
screen.context.onTouchMoved(0, bar.x + bar.width / 2, bar.y + 15, 120)
screen.context.onIdle()
model.snapshot.progress = { ...model.snapshot.progress, position: 12 }
listener(model.snapshot)
assert(named('seek') === bar, 'progress must not replace the control during dragging')
equal(named('time').string, '1:00 / 2:00')
screen.context.onTouchEnded(0, bar.x + bar.width / 2, bar.y + 15, 150)
equal(seeks[0], 60)
bar.behavior.onTouchCancelled(bar)
equal(named('time').string, '0:12 / 2:00')
view.dispose()
view.dispose()
equal(stops, 0, 'closing mini app keeps playback')
equal(model.snapshot.state, 'playing')
assert(!listener, 'dispose removes subscriptions')
app.empty()
view = createPodcastView(model, dimensions)
app.add(view.content)
equal(named('time').string, '0:12 / 2:00', 'reopening restores progress')
tap('play')
equal(pauses, 2, 'reopened control pauses running playback')
tap('stop')
equal(stops, 1)
tap('refresh')
equal(refreshes, 1)
assert(!named('refresh').active)
view.dispose()
view.dispose()
equal(stops, 1, 'dispose does not stop playback or loading')
assert(!listener, 'dispose removes subscriptions')
app.empty()
model.snapshot.loading = false
view = createPodcastView(model, dimensions)
app.add(view.content)
assert(named('play').active, 'reopening keeps selection usable')
view.dispose()
trace('ok\n')
