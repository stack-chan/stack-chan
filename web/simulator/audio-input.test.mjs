import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHostAudioInBridge } from './audio-input.mjs'
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  RECORDING_PREPARE_TIMEOUT_MS,
  RECORDING_STOP_TIMEOUT_MS,
  RECORDING_GRACE_MS,
} from '../../firmware/contracts/audio-recording.js'

const drain = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function rig(options = {}) {
  let now = 0,
    nextTimer = 0
  const timers = new Map(),
    recorders = [],
    tracks = []
  const state = { requests: 0, constructors: 0, stopCalls: 0 }
  function stream() {
    const track = {
      stopped: 0,
      stop() {
        this.stopped++
        options.trackStop?.()
      },
    }
    tracks.push(track)
    return { getTracks: () => [track] }
  }
  class Recorder {
    static isTypeSupported(type) {
      return type === (options.mimeType ?? 'audio/webm;codecs=opus')
    }
    constructor(input, settings) {
      state.constructors++
      options.construct?.()
      this.mimeType = settings.mimeType
      this.state = 'inactive'
      recorders.push(this)
    }
    start() {
      options.start?.()
      this.state = 'recording'
    }
    data(chunk = new Uint8Array([1, 2, 3]).buffer) {
      this.ondataavailable?.({ data: chunk })
    }
    end() {
      this.state = 'inactive'
      this.onstop?.()
    }
    stop() {
      state.stopCalls++
      options.stop?.()
      this.state = 'inactive'
      if (!options.holdStop) {
        this.data()
        this.end()
      }
    }
  }
  const bridge = createHostAudioInBridge({
    mediaDevices: {
      getUserMedia: () => {
        state.requests++
        return options.getUserMedia ? options.getUserMedia() : Promise.resolve(stream())
      },
    },
    MediaRecorder: Recorder,
    readChunks: options.readChunks,
    setTimeoutFn(fn, delay) {
      options.setTimer?.()
      const id = ++nextTimer
      timers.set(id, { fn, at: now + delay })
      return id
    },
    clearTimeoutFn(id) {
      timers.delete(id)
      options.clearTimer?.()
    },
  })
  async function advance(ms) {
    const until = now + ms
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].fn()
      await drain()
    }
    now = until
    await drain()
  }
  return { bridge, advance, stream, timers, recorders, tracks, state }
}

describe('browser recording ownership', () => {
  it('preserves the order and exact lengths of many Blob and typed-array slices', async () => {
    const r = rig({ holdStop: true })
    const id = r.bridge.startRecord(10)
    await drain()
    const expected = []
    for (let index = 0; index < 30; index++) {
      const backing = Uint8Array.of(99, index, index + 1, 99)
      const part = backing.subarray(1, 3)
      r.recorders[0].data(index % 2 ? new Blob([part]) : part)
      expected.push(index, index + 1)
    }
    await r.advance(10)
    r.recorders[0].end()
    await drain()
    assert.equal(r.bridge.recordStatus(id), 1)
    assert.deepEqual([...new Uint8Array(r.bridge.recordBuffer(id))], expected)
    assert.equal(r.bridge.recordDetails(id).quiet, true)
    assert.equal(r.timers.size, 0)
    r.bridge.releaseRecord(id)
    await r.bridge.close()
  })

  it('rejects an aggregate conversion with inconsistent byte count and releases its input', async () => {
    const r = rig({ readChunks: async () => new ArrayBuffer(4) })
    const id = r.bridge.startRecord(10)
    await drain()
    await r.advance(10)
    assert.equal(r.bridge.recordDetails(id).error.code, 'IO')
    assert.equal(r.bridge.recordDetails(id).quiet, true)
    assert.equal(r.bridge.recordBuffer(id), undefined)
    assert.equal(r.tracks[0].stopped, 1)
    r.bridge.releaseRecord(id)
    await r.bridge.close()
  })

  it('completes and cancels 100 recordings without leaving tracks or timers', async () => {
    const r = rig()
    for (let index = 0; index < 100; index++) {
      const id = r.bridge.startRecord(10)
      await drain()
      if (index % 2) {
        r.bridge.stopRecord(id)
        await drain()
        assert.equal(r.bridge.recordDetails(id).error.code, 'CANCELLED')
        assert.equal(r.bridge.recordBuffer(id), undefined)
      } else {
        await r.advance(10)
        assert.equal(r.bridge.recordStatus(id), 1)
        assert.deepEqual([...new Uint8Array(r.bridge.recordBuffer(id))], [1, 2, 3])
        assert.equal(r.bridge.recordDetails(id).mimeType, 'audio/webm;codecs=opus')
        assert.equal(r.bridge.recordDetails(id).filename, 'speak.webm')
      }
      assert.equal(r.bridge.recordDetails(id).quiet, true)
      assert.equal(r.tracks.at(-1).stopped, 1)
      assert.equal(r.timers.size, 0)
      assert.equal(r.recorders.at(-1).onstop, null)
      r.bridge.releaseRecord(id)
    }
    await r.bridge.close()
    assert.equal(r.state.requests, 100)
  })

  it('does not transfer input while the recorder stop event is pending', async () => {
    const r = rig({ holdStop: true })
    const first = r.bridge.startRecord(10)
    await drain()
    await r.advance(10)
    assert.equal(r.bridge.recordStatus(first), 2)
    const busy = r.bridge.startRecord(10)
    assert.equal(r.bridge.recordDetails(busy).error.code, 'BUSY')
    r.bridge.releaseRecord(busy)
    r.bridge.stopRecord(first)
    assert.equal(r.tracks[0].stopped, 1)
    assert.equal(r.bridge.recordDetails(first).quiet, false)
    r.recorders[0].end()
    await drain()
    assert.equal(r.bridge.recordDetails(first).error.code, 'CANCELLED')
    r.bridge.releaseRecord(first)
    const second = r.bridge.startRecord(10)
    await drain()
    r.bridge.stopRecord(first)
    assert.equal(r.state.stopCalls, 1)
    assert.equal(r.tracks[1].stopped, 0)
    const closing = r.bridge.close()
    r.recorders[1].end()
    await closing
    assert.equal(r.bridge.recordStatus(second), -1)
    assert.equal(r.timers.size, 0)
  })

  it('cancels before a queued permission request is sent', async () => {
    const r = rig()
    r.bridge.startRecord(10)
    await r.bridge.close()
    assert.equal(r.state.requests, 0)
    assert.equal(r.timers.size, 0)
    await assert.rejects(r.bridge.record(10), { code: 'CLOSED' })
  })

  it('waits for a late permission grant and closes those tracks without creating a recorder', async () => {
    const permission = deferred()
    const r = rig({ getUserMedia: () => permission.promise })
    const id = r.bridge.startRecord(10)
    await drain()
    let done = false
    const suspended = r.bridge.suspend().then(() => {
      done = true
    })
    await drain()
    assert.equal(done, false)
    assert.equal(r.bridge.recordDetails(id).quiet, false)
    assert.throws(() => r.bridge.resume(), { code: 'BUSY' })
    permission.resolve(r.stream())
    await suspended
    assert.equal(r.tracks[0].stopped, 1)
    assert.equal(r.state.constructors, 0)
    assert.equal(r.timers.size, 0)
    r.bridge.resume()
    await r.bridge.close()
  })

  for (const late of ['grant', 'deny'])
    it(`bounds an unanswered permission request and cleans up a late ${late}`, async () => {
      const permission = deferred()
      const r = rig({ getUserMedia: () => permission.promise })
      const id = r.bridge.startRecord(10)
      await drain()
      await r.advance(RECORDING_PREPARE_TIMEOUT_MS + RECORDING_STOP_TIMEOUT_MS)
      assert.equal(r.bridge.recordDetails(id).error.code, 'TIMEOUT')
      assert.equal(r.bridge.recordDetails(id).quiet, false)
      assert.equal(r.bridge.recordAvailable(), false)
      await assert.rejects(r.bridge.suspend(), { code: 'TIMEOUT' })
      if (late === 'grant') permission.resolve(r.stream())
      else permission.reject(new Error('permission denied'))
      await drain()
      await r.bridge.suspend()
      r.bridge.resume()
      assert.equal(r.bridge.recordAvailable(), true)
      assert.equal(r.state.constructors, 0)
      assert.ok(r.tracks.every((track) => track.stopped === 1))
      assert.equal(r.timers.size, 0)
      await r.bridge.close()
    })

  it('rejects permission denial without faulting a fully released input', async () => {
    const r = rig({ getUserMedia: () => Promise.reject(new Error('permission denied')) })
    await assert.rejects(r.bridge.record(10), { code: 'IO', message: 'permission denied' })
    assert.equal(r.bridge.recordAvailable(), true)
    assert.equal(r.timers.size, 0)
    await r.bridge.close()
  })

  for (const stage of ['construct', 'start'])
    it(`rolls back tracks after recorder ${stage} fails`, async () => {
      const r = rig({
        [stage]: () => {
          throw new Error(stage)
        },
      })
      await assert.rejects(r.bridge.record(10), { code: 'IO', message: stage })
      assert.equal(r.tracks[0].stopped, 1)
      assert.equal(r.bridge.recordAvailable(), true)
      assert.equal(r.timers.size, 0)
      await r.bridge.close()
    })

  for (const stage of ['stop', 'trackStop', 'clearTimer'])
    it(`preserves a ${stage} failure and still attempts other cleanup`, async () => {
      let fail = false
      const r = rig({
        [stage]: () => {
          if (fail) throw new Error(stage)
        },
      })
      const id = r.bridge.startRecord(10)
      await drain()
      fail = true
      r.bridge.stopRecord(id)
      await drain()
      assert.equal(r.bridge.recordDetails(id).error.code, 'IO')
      assert.equal(r.bridge.recordDetails(id).quiet, false)
      assert.equal(r.tracks[0].stopped, 1)
      assert.equal(r.state.stopCalls, 1)
      assert.equal(r.bridge.recordAvailable(), false)
      await assert.rejects(r.bridge.close(), { code: 'IO' })
      assert.equal(r.timers.size, 0)
    })

  it('still stops the recorder if the stop-deadline timer cannot be allocated', async () => {
    let fail = false
    const r = rig({
      setTimer: () => {
        if (fail) throw new Error('timer unavailable')
      },
    })
    const id = r.bridge.startRecord(10)
    await drain()
    fail = true
    r.bridge.stopRecord(id)
    assert.equal(r.state.stopCalls, 1)
    assert.equal(r.tracks[0].stopped, 1)
    assert.equal(r.bridge.recordDetails(id).error.code, 'IO')
    await assert.rejects(r.bridge.close(), { code: 'IO' })
  })

  it('waits for an in-flight aggregate conversion before returning cancellation', async () => {
    const converted = deferred()
    const r = rig({ holdStop: true, readChunks: () => converted.promise })
    const id = r.bridge.startRecord(10)
    await drain()
    r.recorders[0].data(Uint8Array.of(1, 2, 3))
    await r.advance(10)
    r.recorders[0].end()
    await drain()
    r.bridge.stopRecord(id)
    assert.equal(r.bridge.recordDetails(id).quiet, false)
    converted.resolve(new Uint8Array([1, 2, 3]).buffer)
    await drain()
    assert.equal(r.bridge.recordDetails(id).quiet, true)
    assert.equal(r.bridge.recordDetails(id).error.code, 'CANCELLED')
    assert.equal(r.bridge.recordBuffer(id), undefined)
    assert.equal(r.timers.size, 0)
    r.bridge.releaseRecord(id)
    await r.bridge.close()
  })

  it('faults when a stop acknowledgement never arrives, but owns a late acknowledgement', async () => {
    const r = rig({ holdStop: true })
    const id = r.bridge.startRecord(10)
    await drain()
    r.bridge.stopRecord(id)
    await r.advance(RECORDING_STOP_TIMEOUT_MS)
    assert.equal(r.bridge.recordDetails(id).error.code, 'TIMEOUT')
    assert.equal(r.bridge.recordDetails(id).quiet, false)
    assert.equal(r.tracks[0].stopped, 1)
    await assert.rejects(r.bridge.suspend(), { code: 'TIMEOUT' })
    r.recorders[0].end()
    await drain()
    await r.bridge.suspend()
    r.bridge.resume()
    assert.equal(r.bridge.recordAvailable(), true)
    await r.bridge.close()
  })

  it('rejects an empty recording and an unsolicited stop', async () => {
    for (const normal of [false, true]) {
      const r = rig({ holdStop: true })
      const id = r.bridge.startRecord(10)
      await drain()
      if (normal) await r.advance(10)
      r.recorders[0].end()
      await drain()
      assert.equal(r.bridge.recordDetails(id).error.code, 'IO')
      assert.equal(r.bridge.recordDetails(id).quiet, true)
      assert.equal(r.tracks[0].stopped, 1)
      assert.equal(r.timers.size, 0)
      await r.bridge.close()
    }
  })

  it('bounds chunk size and rejects inconsistent encoded data', async () => {
    for (const chunk of [
      new ArrayBuffer(MAX_RECORDING_BYTES + 1),
      { size: 2, arrayBuffer: async () => new ArrayBuffer(3) },
      { size: -1 },
    ]) {
      const r = rig()
      const id = r.bridge.startRecord(10)
      await drain()
      r.recorders[0].data(chunk)
      await r.advance(10 + RECORDING_GRACE_MS)
      assert.equal(r.bridge.recordDetails(id).error.code, 'IO')
      assert.equal(r.bridge.recordDetails(id).quiet, true)
      assert.equal(r.tracks[0].stopped, 1)
      assert.equal(r.timers.size, 0)
      await r.bridge.close()
    }
  })

  it('rejects invalid durations before requesting browser input', async () => {
    const r = rig()
    for (const duration of [0, -1, NaN, Infinity, MAX_RECORDING_DURATION_MS + 1]) {
      await assert.rejects(r.bridge.record(duration), { code: 'INVALID_ARGUMENT' })
    }
    assert.equal(r.state.requests, 0)
    assert.equal(r.timers.size, 0)
    await r.bridge.close()
  })

  it('bounds retained handles and allows reuse after releasing them', async () => {
    const r = rig()
    const handles = Array.from({ length: 4 }, () => r.bridge.startRecord(0))
    assert.ok(handles.every(Boolean))
    assert.equal(r.bridge.startRecord(0), 0)
    for (const id of handles) r.bridge.releaseRecord(id)
    const next = r.bridge.startRecord(10)
    assert.ok(next && !handles.includes(next))
    await r.bridge.close()
    assert.equal(r.state.requests, 0)
  })
})
