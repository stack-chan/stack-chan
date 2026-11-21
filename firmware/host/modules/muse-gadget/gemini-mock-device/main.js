import { createGuruguruView } from 'guruguru-view'
import endpoint from 'mock-config'
import { AccountSession } from 'muse-pairing-native'
import { createDeviceAccountNetwork } from 'muse-setup/device-account-network'
import { internalFree, internalMinimum, psramFree } from 'offline-heap'
import { Application, Skin } from 'piu/MC'
import { openOutput } from 'stackchan/voice/cores3-pcm-output'
import { createGeminiSpeechTTS } from 'stackchan/voice/gemini-worker-tts'
import { subscribePcmSource } from 'stackchan/voice/media'
import { createVoiceScope } from 'stackchan/voice/scope'
import Time from 'time'
import Timer from 'timer'

const marker = (value) => trace(`GEMINI_PRESSURE ${JSON.stringify(value)}\n`)
const pause = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const view = createGuruguruView()
new Application(null, { skin: new Skin({ fill: 'black' }), displayListLength: 4096, contents: [view.content] })
async function runCase(mode, size, run) {
  const scope = createVoiceScope(),
    started = Time.ticks
  const expected = (size === 'long' ? 50 : 10) * 5760
  let received = 0,
    calls = 0,
    firstPcmMs = null,
    lastPcmAt,
    maxPacketGapMs = 0,
    maximumLag = 0,
    previous = Time.ticks,
    output,
    subscription,
    session,
    failure
  const heartbeat = Timer.repeat(() => {
    const now = Time.ticks
    maximumLag = Math.max(maximumLag, now - previous - 50)
    previous = now
  }, 50)
  const watchdog = Timer.set(() => scope.abort(Object.assign(new Error(), { code: 'deadline_exceeded' })), 90000)
  try {
    if (mode === 'full') output = openOutput(24000, 0, 24576, () => {})
    view.model.setState('speak')
    session = await createGeminiSpeechTTS({
      endpoint: `${endpoint}/${size}`,
      transportTimeoutMs: 30000,
      onMetrics: (v) => {
        if (v.stageMs) marker({ phase: 'stage-ms', mode, size, run, values: v.stageMs })
      },
      onTransport: (values) => marker({ phase: 'transport', mode, size, run, values }),
      onFailure: (reason) => marker({ phase: 'reason', mode, size, run, reason }),
    }).open({ signal: scope.signal, format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } })
    subscription = subscribePcmSource(session.output, {
      async write(bytes) {
        if (
          bytes[0] !== (received % 5760) % 256 ||
          bytes[bytes.length - 1] !== ((received + bytes.length - 1) % 5760) % 256
        )
          throw Error('fixture sample mismatch')
        const now = Time.ticks
        if (firstPcmMs === null) firstPcmMs = now - started
        else maxPacketGapMs = Math.max(maxPacketGapMs, now - lastPcmAt)
        lastPcmAt = now
        received += bytes.length
        calls++
        await output?.write(bytes)
      },
      end(error) {
        if (error) failure = error
      },
    })
    await session.write('synthetic fixture')
    await session.endInput()
    if (failure) throw failure
    await output?.drain()
    if (received !== expected) throw Error('byte mismatch')
    marker({
      phase: 'pass',
      mode,
      size,
      run,
      received,
      expected,
      calls,
      elapsedMs: Time.ticks - started,
      firstPcmMs,
      maxPacketGapMs,
      maximumLag,
      internal: internalFree(),
      minimum: internalMinimum(),
      psram: psramFree(),
    })
    return true
  } catch (error) {
    marker({
      phase: 'fail',
      mode,
      size,
      run,
      received,
      expected,
      calls,
      elapsedMs: Time.ticks - started,
      firstPcmMs,
      maxPacketGapMs,
      maximumLag,
      code: ['provider_failed', 'deadline_exceeded', 'resource_exhausted', 'cancelled'].includes(error.code)
        ? error.code
        : 'unknown',
    })
    return false
  } finally {
    Timer.clear(heartbeat)
    Timer.clear(watchdog)
    subscription?.close()
    await session?.close()
    output?.close()
    scope.dispose()
    view.model.setState('idle')
  }
}
Timer.set(() => {
  void (async () => {
    const account = AccountSession.restore()
    const network = createDeviceAccountNetwork()
    try {
      await network.prepare(account, account.generation)
      marker({ phase: 'network-ready' })
      let passed = true
      for (let run = 0; run < 5 && passed; run++) {
        for (const size of ['short', 'long']) {
          for (const mode of run % 2 ? ['full', 'decode-only'] : ['decode-only', 'full']) {
            if (!(await runCase(mode, size, run))) passed = false
            if (internalMinimum() < 32768) {
              marker({ phase: 'low-headroom', mode, size, run, minimum: internalMinimum() })
              marker({ phase: 'done', passed: false })
              return
            }
            if (!passed) break
            await pause(500)
          }
          if (!passed) break
        }
      }
      marker({ phase: 'done', passed })
    } finally {
      network.close()
      account.close()
    }
  })().catch(() => marker({ phase: 'fatal' }))
}, 1500)
