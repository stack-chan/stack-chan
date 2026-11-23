import { pcmLevel } from 'muse-stopwatch-levels'
import { createGuruguruView } from 'guruguru-view'
import { internalFree, internalMinimum, psramFree } from 'offline-heap'
import { Application, Skin } from 'piu/MC'
import { audioEventLayout, replayAudioEvent } from 'pressure-fixture'
import { openOutput } from 'stackchan/voice/cores3-pcm-output'
import { createGeminiSpeechTTS } from 'stackchan/voice/gemini-speech'
import { subscribePcmSource } from 'stackchan/voice/media'
import { createVoiceScope, requireActive } from 'stackchan/voice/scope'
import Time from 'time'
import Timer from 'timer'

const marker = (value) => trace(`GEMINI_PRESSURE ${JSON.stringify(value)}\n`)
const view = createGuruguruView()
new Application(null, { skin: new Skin({ fill: 'black' }), displayListLength: 4096, contents: [view.content] })
const pause = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const heap = () => ({ internal: internalFree(), internalMinimum: internalMinimum(), psram: psramFree() })
async function runCase(mode, eventBytes = 8192) {
  const events = 4
  const expected = audioEventLayout(eventBytes).pcmBytes * events
  const scope = createVoiceScope()
  let output, session, subscription, heartbeat, watchdog, failure
  let count = 0,
    received = 0,
    maximumLag = 0,
    lateTicks = 0,
    ticks = 0
  let minimumInternal = internalFree(),
    minimumPsram = psramFree()
  let previous = Time.ticks
  const started = previous
  const timing = {
    sinkCalls: 0,
    sinkCallMax: 0,
    sinkAwaitMax: 0,
    sinkTotal: 0,
    consumeCalls: 0,
    consumeCallMax: 0,
    consumeAwaitMax: 0,
    consumeTotal: 0,
    drainMs: 0,
  }
  const report = (phase, code) =>
    marker({
      phase,
      mode,
      eventBytes,
      events,
      count,
      received,
      expected,
      code,
      elapsedMs: Time.ticks - started,
      ticks,
      lateTicks,
      maximumLag,
      minimumInternal,
      minimumPsram,
      ...timing,
      ...heap(),
    })
  async function write(bytes) {
    requireActive(scope.signal)
    received += bytes.length
    timing.sinkCalls++
    const before = Time.ticks
    try {
      const pending = output?.write(bytes)
      timing.sinkCallMax = Math.max(timing.sinkCallMax, Time.ticks - before)
      await pending
    } finally {
      const elapsed = Time.ticks - before
      timing.sinkAwaitMax = Math.max(timing.sinkAwaitMax, elapsed)
      timing.sinkTotal += elapsed
    }
    requireActive(scope.signal)
  }
  marker({ phase: 'start', mode, eventBytes, events, ...heap() })
  try {
    heartbeat = Timer.repeat(() => {
      const now = Time.ticks
      const lag = Math.max(0, now - previous - 50)
      maximumLag = Math.max(maximumLag, lag)
      if (lag > 50) lateTicks++
      previous = now
      ticks++
      minimumInternal = Math.min(minimumInternal, internalFree())
      minimumPsram = Math.min(minimumPsram, psramFree())
    }, 50)
    watchdog = Timer.set(() => {
      scope.abort(Object.assign(new Error('fixture deadline'), { code: 'deadline_exceeded' }))
      output?.close()
    }, 30000)
    if (mode !== 'decode-only') output = openOutput(24000, 0, 24576, () => {})
    view.model.setState('speak')
    if (mode === 'raw-speaker') {
      const pcm = new Uint8Array(1024)
      const perEvent = audioEventLayout(eventBytes).pcmBytes
      for (let i = 0; i < events; i++) {
        for (let at = 0; at < perEvent; at += pcm.length)
          await write(pcm.subarray(0, Math.min(pcm.length, perEvent - at)))
        count++
      }
    } else {
      const tts = createGeminiSpeechTTS({
        timeoutMs: 10000,
        async request(body, consume, requestScope) {
          for (const bytes of body.read()) requireActive(requestScope.signal)
          const timedConsume = async (bytes) => {
            timing.consumeCalls++
            const before = Time.ticks
            try {
              const pending = consume(bytes)
              timing.consumeCallMax = Math.max(timing.consumeCallMax, Time.ticks - before)
              await pending
            } finally {
              const elapsed = Time.ticks - before
              timing.consumeAwaitMax = Math.max(timing.consumeAwaitMax, elapsed)
              timing.consumeTotal += elapsed
            }
          }
          for (let i = 0; i < events; i++) {
            await replayAudioEvent(eventBytes, timedConsume, () => requireActive(requestScope.signal))
            count++
          }
          await timedConsume(
            new Uint8Array(
              ArrayBuffer.fromString(
                'data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n',
              ),
            ),
          )
        },
      })
      session = await tts.open({
        signal: scope.signal,
        format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
        voice: 'Leda',
      })
      subscription = subscribePcmSource(session.output, {
        write,
        end(error) {
          if (error) failure = error
        },
      })
      await session.write('offline fixture')
      await session.endInput()
      if (failure) throw failure
    }
    const draining = Time.ticks
    try {
      await output?.drain()
    } finally {
      timing.drainMs = Time.ticks - draining
    }
    if (received !== expected) throw new Error('fixture byte mismatch')
    await pause(60)
    report('pass')
    return true
  } catch (error) {
    const allowed = [
      'deadline_exceeded',
      'resource_exhausted',
      'provider_failed',
      'cancelled',
      'unsupported_capability',
    ]
    report('fail', allowed.includes(error?.code) ? error.code : 'unknown')
    return false
  } finally {
    if (heartbeat !== undefined) Timer.clear(heartbeat)
    if (watchdog !== undefined) Timer.clear(watchdog)
    subscription?.close()
    await session?.close()
    output?.close()
    scope.dispose()
    view.model.setState('idle')
  }
}
async function nativeChecks() {
  if (typeof Uint8Array.fromBase64 !== 'function') throw new Error('native decoder unavailable')
  for (const data of ['', 'AA=\n', 'AAAAAAA\n', 'AA A', 'AA=A', 'A===', 'AB==', 'AAB=', 'AAAA\0AAA']) {
    const scope = createVoiceScope()
    let received = 0,
      rejected = false
    const session = await createGeminiSpeechTTS({
      async request(body, consume) {
        for (const bytes of body.read()) void bytes
        await consume(
          new Uint8Array(
            ArrayBuffer.fromString(
              'data: ' + JSON.stringify({ event_type: 'step.delta', delta: { type: 'audio', data } }) + '\n\n',
            ),
          ),
        )
      },
    }).open({ signal: scope.signal, format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } })
    const subscription = subscribePcmSource(session.output, {
      write(bytes) {
        received += bytes.length
      },
      end() {},
    })
    try {
      await session.write('fixture')
      await session.endInput()
    } catch (error) {
      rejected = error.code === 'provider_failed'
    } finally {
      subscription.close()
      await session.close()
      scope.dispose()
    }
    if (!rejected || received) throw new Error('invalid audio accepted')
  }
  for (const samples of [[], [-32768, 32767], [0, 1000, -2000, 3000]]) {
    const data = new Uint8Array(new Int16Array(samples).buffer)
    const expected = samples.length
      ? samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length / 32768
      : 0
    if (Math.abs(pcmLevel(data) - expected) > 0.5 / 32768) throw new Error('native level mismatch')
  }
  marker({ phase: 'native-checks', passed: true })
}
Timer.set(() => {
  void (async () => {
    await nativeChecks()
    marker({ phase: 'capability', nativeBase64: typeof Uint8Array.fromBase64 === 'function' })
    let passed = true
    for (const mode of ['decode-only', 'raw-speaker', 'full']) {
      if (!(await runCase(mode))) passed = false
      await pause(500)
    }
    if (!(await runCase('full', 65536))) passed = false
    view.close()
    marker({ phase: 'done', passed })
  })().catch(() => marker({ phase: 'fatal' }))
}, 1500)
