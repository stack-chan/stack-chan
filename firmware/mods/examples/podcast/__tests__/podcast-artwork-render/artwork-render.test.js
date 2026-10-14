import { thumbnail } from 'art-tests'
import Bitmap from 'commodetto/Bitmap'
import BufferOut from 'commodetto/BufferOut'
import { Application } from 'piu/MC'
import { i18n } from 'podcast-test-i18n'
import { createPodcastView } from 'podcast-view'
import { assert, equal } from 'testing/assert'

// Match CoreS3's RGB565BE target. Capture real Piu/RuntimeBitmapPort output.
equal(screen.pixelFormat, Bitmap.RGB565BE)
const output = new BufferOut({ width: 320, height: 240, pixelFormat: screen.pixelFormat })
const simulatorScreen = screen
// Plain wrapper supplies Piu's display lifecycle while BufferOut retains the emitted pixels.
globalThis.screen = {
  width: output.width,
  height: output.height,
  pixelFormat: output.pixelFormat,
  pixelsToBytes: (n) => output.pixelsToBytes(n),
  begin: (...args) => output.begin(...args),
  send: (...args) => output.send(...args),
  end() {},
  continue() {},
  adaptInvalid() {},
  start() {},
  stop() {},
}
let listener
const model = {
  snapshot: {
    feeds: [{ title: 'Test' }],
    feedIndex: 0,
    episodes: [{ title: 'Test episode' }],
    episodeIndex: 0,
    artEnabled: true,
    loading: false,
    state: 'idle',
    progress: { position: 0, seekable: false },
  },
  subscribe(callback) {
    listener = callback
    callback(this.snapshot)
    return () => {
      listener = undefined
    }
  },
}
const view = createPodcastView(model, { width: 320, height: 196 }, i18n)
const app = new Application(null, { displayListLength: 4096, contents: [view.content] })
const pixels = new DataView(output.buffer)
const sample = (x, y) => pixels.getUint16((y * 320 + x) * 2)
const context = screen.context
context.onIdle()
const before = sample(18, 40)
model.snapshot.artwork = thumbnail
listener(model.snapshot)
context.onIdle()
assert(sample(18, 40) !== before, 'arrival invalidates and redraws the artwork region')
assert((sample(18, 40) & 0xf800) > 0xf000, 'Piu emits red pixels from decoded JPEG')
assert((sample(58, 40) & 0x001f) > 28, 'Piu emits blue pixels from decoded JPEG')
// Reopening must draw the already loaded thumbnail too.
view.dispose()
app.empty()
const reopened = createPodcastView(model, { width: 320, height: 196 }, i18n)
app.add(reopened.content)
context.onIdle()
assert((sample(18, 40) & 0xf800) > 0xf000, 'reopening renders the retained image')
reopened.dispose()
app.empty()
globalThis.screen = simulatorScreen
