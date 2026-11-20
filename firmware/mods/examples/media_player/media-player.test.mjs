import assert from 'node:assert/strict'
import test from 'node:test'
import { PodcastController } from '../podcast/controller.js'
import { installVolume } from './volume.js'

function harness() {
  const starts = [],
    loads = []
  let active,
    stops = 0,
    notes = false,
    motion = true,
    indicator = false
  const media = {
    start(options) {
      this.stop()
      active = options
      starts.push(options)
      options.onStateChanged('connecting')
      return Promise.resolve()
    },
    stop() {
      stops++
      const previous = active
      active = undefined
      previous?.onStateChanged('idle')
    },
    pause() {
      active?.onStateChanged('paused')
    },
    resume() {
      active?.onStateChanged('playing')
      return Promise.resolve()
    },
    seek() {
      return Promise.resolve()
    },
  }
  const context = {
    audio: { media },
    connectivity: { network: { ready: Promise.resolve({ status: 'connected' }) } },
    ui: {
      setFaceMotionEnabled(value) {
        motion = value
      },
      application: {
        distribute(_event, value) {
          indicator = value
        },
      },
    },
  }
  const player = new PodcastController(
    context,
    [{ title: 'Show', url: 'feed' }],
    () => {
      const load = {
        cancelled: false,
        cancel() {
          this.cancelled = true
        },
      }
      load.promise = new Promise((resolve, reject) => Object.assign(load, { resolve, reject }))
      loads.push(load)
      return load
    },
    {
      show() {
        notes = true
      },
      hide() {
        notes = false
      },
    },
    undefined,
    [
      { title: 'One', url: 'radio-one' },
      { title: 'Two', url: 'radio-two' },
    ],
  )
  return { player, media, starts, loads, state: () => ({ stops, notes, motion, indicator }) }
}

async function episodes(h) {
  const refresh = h.player.refresh()
  h.loads.at(-1).resolve({ episodes: [{ identity: 'one', title: 'Episode', url: 'episode', duration: 60 }] })
  await refresh
}

test('both players start manually and retain playback when a view unsubscribes', async () => {
  const h = harness()
  await episodes(h)
  h.player.selectStation(1)
  assert.equal(h.starts.length, 0)
  const unsubscribe = h.player.subscribe(() => {})
  await h.player.playRadio()
  h.starts.at(-1).onStateChanged('playing')
  unsubscribe()
  assert.deepEqual(h.state(), { stops: 2, notes: true, motion: false, indicator: false })
  let snapshot
  h.player.subscribe((value) => {
    snapshot = value
  })()
  assert.equal(snapshot.radioState, 'playing')
  assert.equal(snapshot.stationIndex, 1)
  assert.equal(h.starts.at(-1).mode, 'live')
  assert.equal(h.starts.at(-1).volume, undefined, 'host applies the shared saved volume')
  h.player.close()
})

test('switching playback rejects old callbacks, progress, seek failures and start rejections', async () => {
  const h = harness()
  await episodes(h)
  let rejectStart
  const start = h.media.start.bind(h.media)
  h.media.start = (options) => {
    start(options)
    return new Promise((_resolve, reject) => {
      rejectStart = reject
    })
  }
  const pending = h.player.play()
  const old = h.starts.at(-1)
  h.media.start = start
  let rejectSeek
  h.media.seek = () =>
    new Promise((_resolve, reject) => {
      rejectSeek = reject
    })
  const seek = h.player.seek(30)
  await h.player.playRadio()
  const current = h.starts.at(-1)
  current.onStateChanged('playing')
  old.onStateChanged('playing')
  old.onProgress({ position: 40, duration: 60, seekable: true })
  rejectStart(new Error('old connection failed'))
  rejectSeek(new Error('old seek failed'))
  await Promise.all([pending, seek])
  assert.equal(h.player.snapshot.source, 'radio')
  assert.equal(h.player.snapshot.radioState, 'playing')
  assert.equal(h.player.snapshot.state, 'idle')
  assert.equal(h.player.snapshot.progress.position, 0)
  assert.equal(h.player.snapshot.playbackError, undefined)
  assert.equal(h.state().notes, true)
  assert.equal(h.state().motion, false)
  await h.player.play()
  current.onStateChanged('error', 'late radio error')
  assert.equal(h.player.snapshot.source, 'podcast')
  assert.equal(h.player.snapshot.radioState, 'idle')
  assert.equal(h.starts.at(-1).mode, 'finite')
  h.player.close()
})

test('Podcast listing and stopping cannot stop or reset the Radio', async () => {
  const h = harness()
  await episodes(h)
  const refresh = h.player.refresh()
  await h.player.playRadio()
  const radio = h.starts.at(-1)
  radio.onStateChanged('retrying', 'offline')
  const before = h.state()
  assert.equal(h.loads.at(-1).cancelled, false, 'playback switch leaves RSS alone')
  h.loads.at(-1).resolve({ episodes: [{ identity: 'new', title: 'New', url: 'new' }] })
  await refresh
  assert.deepEqual(h.state(), before, 'RSS completion does not overwrite the audio indicator')
  h.player.selectEpisode(0)
  h.player.stop()
  h.player.pause()
  await h.player.seek(2)
  assert.equal(h.state().stops, before.stops)
  assert.equal(h.player.snapshot.radioState, 'retrying')
  h.player.stopRadio()
  radio.onStateChanged('playing')
  assert.equal(h.state().notes, false)
  assert.equal(h.state().motion, true)
  assert.equal(h.state().indicator, false)
  h.player.close()
})

test('a rejected replacement cannot leave the previous audio playing behind an error view', async () => {
  const h = harness()
  await episodes(h)
  await h.player.play()
  h.starts.at(-1).onStateChanged('playing')
  const before = h.state().stops
  h.media.start = async () => {
    throw new Error('invalid station URL')
  }
  await h.player.playRadio()
  assert.equal(h.state().stops, before + 1)
  assert.equal(h.player.snapshot.radioState, 'error')
  assert.equal(h.player.snapshot.reason, 'Error: invalid station URL')
  assert.equal(h.state().notes, false)
  assert.equal(h.state().motion, true)
  h.player.close()
})

test('rapid selection, failure, TTS interruption and close leave only the current state', async () => {
  const h = harness()
  await episodes(h)
  for (let index = 0; index < 20; index++) {
    h.player.selectStation(index % 2)
    await h.player.playRadio()
  }
  for (const old of h.starts.slice(0, -1)) old.onStateChanged('playing')
  assert.equal(h.player.snapshot.radioState, 'connecting')
  const latest = h.starts.at(-1)
  latest.onStateChanged('error', 'network failed')
  assert.equal(h.player.snapshot.reason, 'network failed')
  assert.equal(h.state().motion, true)
  await h.player.playRadio()
  h.starts.at(-1).onStateChanged('playing')
  h.media.stop() // The host does this before TTS/tone/audio playback.
  assert.equal(h.player.snapshot.radioState, 'idle')
  assert.equal(h.state().notes, false)
  assert.equal(h.state().motion, true)
  await h.player.playRadio()
  h.player.close()
  const count = h.starts.length
  h.starts.at(-1).onStateChanged('playing')
  await h.player.playRadio()
  h.player.close()
  assert.equal(h.starts.length, count)
  assert.equal(h.state().notes, false)
})

test('a newer start issued by a subscriber supersedes a pending start', async () => {
  const h = harness()
  await episodes(h)
  h.player.subscribe((state) => {
    if (state.source === 'podcast' && state.playbackState === 'connecting') void h.player.playRadio()
  })
  await h.player.play()
  assert.deepEqual(
    h.starts.map((options) => options.mode),
    ['live'],
  )
  h.player.close()
})

test('Drawer presets preserve arbitrary saved volume and recover from mute without restarting playback', () => {
  let volume = 0.35,
    writes = 0,
    button
  const context = {
    audio: {
      get volume() {
        return volume
      },
      set volume(value) {
        volume = value
        writes++
      },
    },
    drawer: {
      addDrawerButton(value) {
        button = value
      },
    },
    i18n: {
      localize(key, values) {
        return values ? `${key}:${values.percent}` : key
      },
    },
  }
  installVolume(context)
  assert.equal(writes, 0)
  assert.equal(volume, 0.35)
  assert.equal(button.label, 'media.volume:35')
  assert.equal(button.options.length, 4)
  for (const value of ['1', '0.5', '0.25', '0', '0.5']) {
    button.callback(context, value)
    assert.equal(volume, Number(value))
    assert.equal(button.value, value)
  }
  button.callback(context, 'unexpected')
  assert.equal(writes, 5)
})
