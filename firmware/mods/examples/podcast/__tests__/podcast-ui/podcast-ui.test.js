import Bitmap from 'commodetto/Bitmap'
import { Application } from 'piu/MC'
import { i18n, setLocale } from 'podcast-test-i18n'
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
    artEnabled: true,
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
    this.snapshot.feedError = undefined
    this.snapshot.loading = true
    listener?.(this.snapshot)
  },
}
const dimensions = { width: 320, height: 196, close() {} }
let view = createPodcastView(model, dimensions, i18n)
const app = new Application(null, { displayListLength: 4096, contents: [view.content] })
function find(name) {
  for (let node = view.content.first; node; node = node.next) if (node.name === name) return node
}
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
assert(named('episode').y + named('episode').height <= named('seek').y, 'episode group must not cover playback')
assert(!find('refresh'), 'normal playback has no refresh button')
assert(
  named('episode').x + named('episode').width === view.content.x + dimensions.width - 8,
  'episode uses the former action space',
)
for (let node = view.content.first; node; node = node.next) assert(node.name !== 'status', 'no detached status row')

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
equal(named('time').string, '0:00 / 2:00')
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
const art = new Bitmap(64, 64, Bitmap.RGB565LE, new ArrayBuffer(64 * 64 * 2), 0)
model.snapshot.artwork = art
listener(model.snapshot)
assert(named('seek') === bar, 'art arrival must not replace a captured seek control')
assert(named('artwork').behavior.bitmap === art)
screen.context.onIdle()
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
view = createPodcastView(model, dimensions, i18n)
app.add(view.content)
equal(named('time').string, '0:12 / 2:00', 'reopening restores progress')
tap('play')
equal(pauses, 2, 'reopened control pauses running playback')
tap('stop')
equal(stops, 1)
model.snapshot.feedError = 'podcast.feedFailed'
listener(model.snapshot)
assert(named('refresh').y === named('episode').y, 'retry belongs to the failed episode field')
tap('refresh')
equal(refreshes, 1)
assert(!find('refresh'), 'retry button disappears during acquisition')
assert(!named('stop').active, 'playback stop does not represent RSS cancellation')
assert(named('episode').first.string.includes('取得中'), 'loading is shown inside the episode field')
assert(!named('episode').active)
view.dispose()
view.dispose()
equal(stops, 1, 'dispose does not stop playback or loading')
assert(!listener, 'dispose removes subscriptions')
app.empty()
model.snapshot.loading = false
view = createPodcastView(model, dimensions, i18n)
app.add(view.content)
assert(named('play').active, 'reopening keeps selection usable')
model.snapshot.artEnabled = false
model.snapshot.feedError = 'podcast.feedFailed'
listener(model.snapshot)
assert(named('episode').first.string.includes('取得できませんでした'), 'RSS error belongs to episode field')
assert(named('refresh').active, 'retry stays next to the failed episode list')
assert(named('episode').x === view.content.x + 8, 'no empty artwork column when artwork is disabled')
view.dispose()
app.empty()
// The same native catalog as MOD resources supplies all three host languages.
for (const [locale, field, failure, retry, paused] of [
  ['ja', 'エピソード', '取得できませんでした', '更新', '一時停止'],
  ['en', 'Episode', 'Could not load episodes', 'Retry', 'Paused'],
  ['zh-CN', '单集', '单集获取失败', '重试', '已暂停'],
]) {
  setLocale(locale)
  model.snapshot.state = 'paused'
  model.snapshot.feedError = 'podcast.feedFailed'
  view = createPodcastView(model, dimensions, i18n)
  app.add(view.content)
  assert(named('episode').first.string.includes(field))
  assert(named('episode').first.string.includes(failure))
  equal(named('refresh').first.string, retry)
  assert(named('time').string.includes(paused))
  screen.context.onIdle() // Includes real font lookup and drawing, also for Chinese.
  tap('refresh')
  assert(!find('refresh'), `${locale}: retry hidden during loading`)
  model.snapshot.loading = false
  listener(model.snapshot)
  assert(!find('refresh'), `${locale}: successful acquisition has no retry`)
  view.dispose()
  app.empty()
}
setLocale('ja')
trace('ok\n')
