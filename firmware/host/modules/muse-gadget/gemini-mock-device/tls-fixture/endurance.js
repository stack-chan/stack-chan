import { checkPCM } from 'fixture-pcm-check'
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
const cases = [
  ['burst', 'short', 0],
  ['burst', 'long', 0],
  ['realtime', 'short', 0],
  ['realtime', 'long', 0],
  ['stall', 'long', 0],
  ['cut', 'long', 1],
  ['burst', 'short', 0],
  ['missing', 'short', 1],
  ['burst', 'short', 0],
  ['realtime', 'long', 2],
  ['burst', 'short', 0],
]
let totalReceived = 0,
  totalExpectedSuccess = 0,
  passedCases = 0
async function runCase(route, size, expectation, reserve, run) {
  const mode = `${route}-reserve${reserve}-expect${expectation}`
  const scope = createVoiceScope()
  const started = Time.ticks
  const before = [internalFree(), psramFree()]
  const expected = (size === 'extended' ? 200 : size === 'long' ? 50 : 10) * 5760
  let received = 0,
    calls = 0,
    first = 0,
    last = 0,
    gap = 0,
    lag = 0,
    previous = started,
    decoded = 0,
    failureReason = 255
  let output,
    session,
    subscription,
    error,
    corrupt = false,
    cancelled = false,
    passed = false
  const heartbeat = Timer.repeat(() => {
    const tick = Time.ticks
    lag = Math.max(lag, tick - previous - 50)
    previous = tick
  }, 50)
  const watchdog = Timer.set(
    () => scope.abort(Object.assign(Error(), { code: 'deadline_exceeded' })),
    size === 'extended' ? 45000 : 22000,
  )
  marker({ phase: 'case-start', mode, size, run, values: [reserve, expectation, expected, ...before] })
  try {
    output = openOutput(24000, 0, 24576, () => {}, reserve)
    view.model.setState('speak')
    session = await createGeminiSpeechTTS({
      endpoint: `${endpoint}/${route}/${size}`,
      transportTimeoutMs: size === 'extended' ? 25000 : 15000,
      onMetrics: (value) => {
        decoded = value.pcmBytes
      },
      onFailure: (value) => {
        failureReason = value
      },
      onTransport: (values) => marker({ phase: 'transport', mode, size, run, values }),
    }).open({ signal: scope.signal, format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } })
    subscription = subscribePcmSource(session.output, {
      async write(bytes) {
        if (!checkPCM(bytes, received)) {
          corrupt = true
          throw Error('fixture mismatch')
        }
        const tick = Time.ticks
        if (!calls) first = tick - started
        else gap = Math.max(gap, tick - last)
        last = tick
        received += bytes.length
        calls++
        await output.write(bytes)
        if (expectation === 2 && received >= 11520 && !cancelled) {
          cancelled = true
          scope.abort(Object.assign(Error(), { code: 'cancelled' }))
        }
      },
      end(reason) {
        if (reason) error = reason
      },
    })
    await session.write('synthetic fixture')
    await session.endInput()
    if (error) throw error
    await output.drain()
    passed = expectation === 0 && !corrupt && received === expected
  } catch (reason) {
    error = reason
    passed =
      !corrupt &&
      (expectation === 1
        ? reason.code === 'provider_failed' &&
          (route === 'missing'
            ? decoded === expected && failureReason === 0 && received >= expected - 8192 && received <= expected
            : received >= 5760 && received <= expected / 2)
        : expectation === 2 && cancelled && reason.code === 'cancelled' && received >= 11520 && received < expected)
  } finally {
    Timer.clear(watchdog)
    Timer.clear(heartbeat)
    subscription?.close()
    try {
      await session?.close()
    } catch {
      passed = false
    }
    try {
      output?.close()
    } catch {
      passed = false
    }
    scope.dispose()
    view.model.setState('idle')
  }
  await pause(120)
  totalReceived += received
  if (expectation === 0) totalExpectedSuccess += expected
  if (passed) passedCases++
  const code = error?.code === 'provider_failed' ? 1 : error?.code === 'cancelled' ? 2 : error ? 3 : 0
  marker({
    phase: passed ? 'case-pass' : 'case-fail',
    mode,
    size,
    run,
    values: [
      received,
      expected,
      calls,
      Time.ticks - started,
      first,
      gap,
      lag,
      code,
      before[0],
      internalFree(),
      before[1],
      psramFree(),
      internalMinimum(),
      corrupt ? 1 : 0,
      decoded,
      failureReason,
    ],
  })
  return passed
}
Timer.set(() => {
  void (async () => {
    const started = Time.ticks
    const initial = [internalFree(), psramFree()]
    const account = AccountSession.restore()
    const network = createDeviceAccountNetwork()
    let passed = true,
      run = 0
    try {
      await network.prepare(account, account.generation)
      marker({ phase: 'network-ready', values: initial })
      for (let round = 0; round < 2 && passed; round++) {
        for (const reserve of round ? [3, 1] : [1, 3]) {
          for (const [route, size, expectation] of cases) {
            if (Time.ticks - started > 330000 || internalMinimum() < 32768) {
              passed = false
              break
            }
            if (!(await runCase(route, size, expectation, reserve, run++))) {
              passed = false
              if (Time.ticks - started <= 330000 && internalMinimum() >= 32768) {
                marker({ phase: 'recovery-start', mode: 'burst', run, values: [reserve] })
                await runCase('burst', 'short', 0, reserve, run++)
              }
              break
            }
          }
          if (!passed) break
        }
      }
      if (passed && internalMinimum() < 32768) passed = false
      if (passed) {
        passed = await runCase('realtime', 'extended', 0, 1, run++)
        if (!passed && Time.ticks - started <= 330000 && internalMinimum() >= 32768) {
          marker({ phase: 'recovery-start', mode: 'burst', run, values: [1] })
          await runCase('burst', 'short', 0, 1, run++)
        }
      }
      for (const reserve of [1, 3]) {
        if (!passed) break
        if (Time.ticks - started > 330000 || internalMinimum() < 32768) {
          passed = false
          break
        }
        passed = await runCase('slow', 'long', 0, reserve, run++)
        if (!passed && Time.ticks - started <= 330000 && internalMinimum() >= 32768) {
          marker({ phase: 'recovery-start', mode: 'burst', run, values: [reserve] })
          await runCase('burst', 'short', 0, reserve, run++)
        }
      }
    } finally {
      network.close()
      account.close()
    }
    marker({
      phase: 'summary',
      values: [
        passed ? 1 : 0,
        run,
        passedCases,
        totalReceived,
        totalExpectedSuccess,
        Time.ticks - started,
        initial[0],
        internalFree(),
        initial[1],
        psramFree(),
        internalMinimum(),
      ],
    })
    marker({ phase: 'done', passed })
  })().catch(() => marker({ phase: 'fatal' }))
}, 1500)
