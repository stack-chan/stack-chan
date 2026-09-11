import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

// Build with npm run mod:build -- host/modules/audio/__tests__/wasm-recording-browser/manifest.json --mode=release
const archive = resolve('../firmware/dist/bin/esp32/release/wasm-recording-browser/wasm-recording-browser.xsa')
assert.ok(existsSync(archive), 'Build the recording integration MOD first')
const { baseUrl, server } = await startPreview({ port: Number(process.env.STACKCHAN_RECORDING_TEST_PORT ?? 8103) })
let browser, page
const messages = []
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
    ],
  })
  const context = await browser.newContext({ permissions: ['microphone'] })
  await context.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    const state = (window.recordingTest = {
      tracks: 0,
      maxTracks: 0,
      requests: 0,
      hold: false,
      grants: [],
      events: [],
      buffers: {},
      played: [],
      activeContexts: 0,
      maxContexts: 0,
      holdDecode: false,
      decodes: [],
      sourceStarts: 0,
    })
    const NativeAudioContext = window.AudioContext
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args)
        state.activeContexts++
        state.maxContexts = Math.max(state.maxContexts, state.activeContexts)
      }
      async close() {
        await super.close()
        state.activeContexts--
      }
      async decodeAudioData(buffer) {
        const hold = state.holdDecode
        const decoded = await super.decodeAudioData(buffer)
        if (hold) return new Promise((resolve) => state.decodes.push(() => resolve(decoded)))
        return decoded
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source)
        source.start = (...args) => {
          state.sourceStarts++
          return start(...args)
        }
        return source
      }
    }
    const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async function (options) {
      const hold = state.hold
      state.requests++
      const stream = await media(options)
      for (const track of stream.getAudioTracks()) {
        state.tracks++
        state.maxTracks = Math.max(state.maxTracks, state.tracks)
        const stop = track.stop.bind(track)
        let stopped = false
        track.stop = () => {
          stop()
          if (!stopped) {
            stopped = true
            state.tracks--
          }
        }
      }
      if (hold) return new Promise((resolve) => state.grants.push(() => resolve(stream)))
      return stream
    }
  })
  page = await context.newPage()
  await page.route(/\/simulator\/mc\.js(?:\?|$)/, async (route) => {
    const original = new URL(route.request().url())
    if (original.searchParams.has('recordingOriginal')) return route.continue()
    original.searchParams.set('recordingOriginal', '1')
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
      import factory from ${JSON.stringify(original.href)};
      export default function(options) {
        const state = window.recordingTest;
        const input = options.stackchanRuntime.host.AudioIn;
        const output = options.stackchanRuntime.host.AudioOut;
        const buffer = input.recordBuffer, close = output.close, play = output.startPlayBuffer, print = options.print;
        input.recordBuffer = function(id) {
          const result = buffer.call(this, id);
          if (result) {
            let sum = 0;
            for (const byte of new Uint8Array(result)) sum = (sum + byte) >>> 0;
            const details = input.recordDetails(id);
            state.buffers[id] = { bytes: result.byteLength, sum, mimeType: details.mimeType, filename: details.filename };
          }
          return result;
        };
        output.startPlayBuffer = function(buffer, volume) {
          let sum = 0;
          for (const byte of new Uint8Array(buffer)) sum = (sum + byte) >>> 0;
          state.played.push({ bytes: buffer.byteLength, sum });
          return play.call(this, buffer, volume);
        };
        output.close = function() { state.events.push({ kind: 'output-close' }); return close.call(this); };
        options.print = text => {
          if (text.includes('[recording-test]')) state.events.push({ kind: 'firmware', text });
          print(text);
        };
        window.disposeRecordingView = () => options.stackchanRuntime.view.dispose();
        return factory(options);
      }`,
    })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const text = message.text()
    messages.push(text)
    if (/XS abort|\[firmware:err\]|\[main\] error|\[recording-test\] FAIL/.test(text)) errors.push(text)
  })
  const ready = () =>
    page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] app ready'),
      timeout: 45_000,
    })
  await Promise.all([ready(), page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })])
  await Promise.all([ready(), page.getByLabel('MODを追加', { exact: true }).setInputFiles(archive)])
  function assertResults(state) {
    const recorded = state.events
      .filter((event) => event.text?.includes('[recording-test] recorded '))
      .map((event) => JSON.parse(event.text.split('recorded ')[1]))
    assert.ok(recorded.length >= 3)
    assert.deepEqual(
      recorded,
      Object.values(state.buffers),
      'XS receives all encoded bytes and their browser format through C'
    )
    assert.ok(
      recorded.every(
        (result) => result.bytes > 100 && result.mimeType.startsWith('audio/webm') && result.filename.endsWith('.webm')
      )
    )
    for (let index = 0; index < state.events.length; index++) {
      if (!state.events[index].text?.includes('microphone close begin')) continue
      assert.ok(
        state.events[index + 1]?.text?.includes('microphone close end'),
        'Microphone.close never closes AudioOut'
      )
    }
    assert.equal(state.tracks, 0, 'completed and cancelled recordings release every media track')
    assert.equal(state.maxTracks, 1, 'old and new firmware never own microphone streams simultaneously')
    assert.equal(state.activeContexts, 0, 'firmware completion waits for AudioContext close')
    assert.equal(state.maxContexts, 1, 'successive playbacks never overlap browser contexts')
    for (const buffer of recorded) {
      assert.ok(
        state.played.some((played) => played.bytes === buffer.bytes && played.sum === buffer.sum),
        'XS returns every recorded byte to the browser playback boundary'
      )
    }
    assert.ok(state.events.some((event) => event.text?.includes('tone completed')))
    assert.ok(state.events.some((event) => event.text?.includes('tone cancelled')))
    assert.deepEqual(errors, [], messages.slice(-30).join('\n'))
  }
  assertResults(await page.evaluate(() => window.recordingTest))

  // A running oscillator must be closed before the next firmware VM starts.
  await page.getByRole('button', { name: 'C', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.activeContexts === 1)
  await Promise.all([ready(), page.getByRole('button', { name: '再起動', exact: true }).click()])
  assertResults(await page.evaluate(() => window.recordingTest))

  // Hold an actual decode result across restart; it must not create a late source.
  await page.evaluate(() => {
    window.recordingTest.holdDecode = true
  })
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.decodes.length === 1)
  const startsBefore = await page.evaluate(() => window.recordingTest.sourceStarts)
  const outputRestarting = ready()
  await page.getByRole('button', { name: '再起動', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.activeContexts === 0)
  assert.equal(await page.evaluate(() => window.recordingTest.sourceStarts), startsBefore)
  await page.evaluate(() => {
    window.recordingTest.holdDecode = false
    window.recordingTest.decodes.shift()()
  })
  await outputRestarting
  assert.equal(
    await page.evaluate(() => window.recordingTest.sourceStarts),
    startsBefore + 3,
    'only the next VM creates its three recording sources'
  )
  assertResults(await page.evaluate(() => window.recordingTest))

  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.tracks === 1)
  await Promise.all([ready(), page.getByRole('button', { name: '再起動', exact: true }).click()])
  assertResults(await page.evaluate(() => window.recordingTest))

  // A real stream is held behind its permission promise to reproduce a grant
  // delivered after restart begins; the retired VM must never start a recorder.
  await page.evaluate(() => {
    window.recordingTest.hold = true
  })
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.grants.length === 1)
  const restarting = ready()
  await page.getByRole('button', { name: '再起動', exact: true }).click()
  await page.evaluate(() => {
    window.recordingTest.hold = false
    window.recordingTest.grants.shift()()
  })
  await restarting
  assertResults(await page.evaluate(() => window.recordingTest))

  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.tracks === 1)
  await page.evaluate(() => {
    window.recordingTest.holdDecode = true
  })
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await page.waitForFunction(() => window.recordingTest.decodes.length === 1)
  await page.evaluate(() => {
    window.recordingDisposeDone = false
    window.recordingDispose = window.disposeRecordingView().then(() => {
      window.recordingDisposeDone = true
    })
  })
  await page.waitForFunction(() => window.recordingTest.activeContexts === 0 && window.recordingTest.tracks === 0)
  assert.equal(
    await page.evaluate(() => window.recordingDisposeDone),
    false,
    'disposal still owns the decoder continuation'
  )
  await page.evaluate(async () => {
    window.recordingTest.decodes.shift()()
    await window.recordingDispose
  })
  assert.equal(
    await page.evaluate(() => window.recordingTest.tracks),
    0,
    'disposing the view awaits its microphone release'
  )
  assert.deepEqual(errors, [], messages.slice(-30).join('\n'))
  console.log(
    'WASM audio: encoded round trip, tone, playback, cancellation, restart, late permission/decode and disposal passed'
  )
} catch (error) {
  console.error(messages.slice(-50).join('\n'))
  if (page) await page.screenshot({ path: '/tmp/stackchan-recording-failed.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
