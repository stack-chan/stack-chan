// Behavioral review probes against unmodified production source.
// Runs on Node with injected IO/Timer fakes. Does not access hardware or services.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim()
const { commit } = JSON.parse(readFileSync(resolve(here, 'sources.json'), 'utf8'))
const observations = []
const context = vm.createContext({ trace() {} })

async function load(relative, dependencies = {}) {
  const fileName = `${commit}:firmware/${relative}`
  const source = execFileSync('git', ['show', fileName], { cwd: root, encoding: 'utf8' })
  const output = relative.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'transform' }) : source
  const module = new vm.SourceTextModule(output, { context, identifier: fileName })
  await module.link(name => {
    if (!(name in dependencies)) throw new Error(`Missing fake ${name} for ${relative}`)
    const values = dependencies[name]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return module.namespace
}

function timerFake() {
  const jobs = new Map()
  let next = 0
  return {
    jobs,
    repeat(callback, delay) { const id = ++next; jobs.set(id, { callback, delay }); return id },
    set(callback, delay) { const id = ++next; jobs.set(id, { callback, delay }); return id },
    clear(id) { jobs.delete(id) },
  }
}

const timer = timerFake()
const util = await load('host/modules/util/stackchan-util.ts', {
  timer: { default: timer },
  'mac-address': { default: () => '00:00:00:00:00:00' },
})
const { StackchanRuntimeAudio } = await load('host/app/runtime-audio.ts', { 'stackchan-util': util })
const { TTS: StubTTS } = await load('host/modules/audio/wasm/tts-stub.ts')
const silentResult = await new StackchanRuntimeAudio({ tts: new StubTTS() }).say('hello')
assert.deepEqual(JSON.parse(JSON.stringify(silentResult)), { success: true, value: 'hello' })
observations.push({ id: 'P1', observation: 'WASM fallback TTS reports speech success without performing playback', result: silentResult })

let finishSpeech
let speechSettled = false
let speakerStartedDuringSpeech = false
let ttsClosed = 0
const tts = {
  stream(_text, _volume, callback) { finishSpeech = callback },
  close() { ttsClosed += 1 },
}
const audio = new StackchanRuntimeAudio({
  tts,
  speaker: { async tone() { speakerStartedDuringSpeech = !speechSettled } },
})
const speech = audio.say('pending').then(result => { speechSettled = true; return result })
await audio.tone(440, 100)
assert.equal(speakerStartedDuringSpeech, true)
audio.close()
assert.equal(speechSettled, false)
assert.equal(ttsClosed, 0)
finishSpeech()
const afterClose = await speech
assert.equal(afterClose.success, true)
observations.push({ id: 'P2', observation: 'tone enters output while say remains pending; close does not cancel speech; late completion still succeeds', speakerStartedDuringSpeech, ttsClosed, afterClose })

const { MotionController, motionDurationSecondsToMilliseconds } = await load('host/modules/motion/motion-controller.ts', {
  'stackchan-util': util, timer: { default: timer },
})
let attached = 0
let detached = 0
let driverTimer
const driver = {
  onAttached() { attached += 1; driverTimer = timer.repeat(() => {}, 125) },
  onDetached() { detached += 1; timer.clear(driverTimer) },
}
const controller = new MotionController({ driver }, { isPaused: () => false })
controller.close()
assert.equal(attached, 1)
assert.equal(detached, 0)
assert.equal(timer.jobs.has(driverTimer), true)
observations.push({ id: 'P3', observation: 'MotionController.close does not detach its attached driver', attached, detached, driverTimerStillPresent: timer.jobs.has(driverTimer) })
driver.onDetached()

const pwmTimer = timerFake()
const pwmWrites = []
class PWM {
  resolution = 12
  write(value) { pwmWrites.push(value) }
}
const { PWMServoDriver } = await load('host/modules/motion/sg90-driver.ts', {
  'embedded:io/pwm': { default: PWM },
  'motion-controller': { motionDurationSecondsToMilliseconds },
  timer: { default: pwmTimer },
})
const pwm = new PWMServoDriver()
let complete = false
pwm.applyRotation({ y: 0.3, p: 0.1, r: 0 }, 0.5, () => { complete = true })
assert.equal(complete, true)
assert.equal(pwmWrites.length, 0)
observations.push({ id: 'P4', observation: 'PWM applyRotation completion callback runs before the first PWM write', callbackAlreadyCalled: complete, writesAtCallback: pwmWrites.length })
pwm.applyRotation({ y: 0.3, p: 0.1, r: 0 }, 0)
for (const job of [...pwmTimer.jobs.values()]) job.callback()
assert.equal(pwmWrites.some(Number.isNaN), true)
observations.push({ id: 'P5', observation: 'PWM time=0 passes NaN to the injected PWM writer on the first tick', nonFiniteWrites: pwmWrites.filter(x => !Number.isFinite(x)).length })

const { default: WasmMicrophone } = await load('host/modules/audio/wasm/microphone.ts', {
  'audio-buffer': { ownAudioBuffer: value => value },
})
const lipSync = await load('mods/examples/lip_sync/mod.js', { 'calculate-power': { default: () => 0 } })
let lipSyncError
try { lipSync.onContextCreated({ audio: { microphone: new WasmMicrophone() }, setMouthOpen() {} }) }
catch (error) { lipSyncError = error.message }
assert.match(lipSyncError, /start is not a function/)
observations.push({ id: 'P6', observation: 'lip_sync uses a streaming method absent from the WASM Microphone and the public record-only microphone type', error: lipSyncError })

const { resolveAppBehaviors } = await load('host/app/app-behavior-resolver.ts')
const calls = []
const defaults = { onLaunch() { calls.push('default-launch') }, onContextCreated() {} }
const mod = { onContextCreated() { calls.push('mod-context') } }
const [resolved] = resolveAppBehaviors({ has: () => true, importNow: () => mod }, defaults)
resolved.onLaunch()
resolved.onContextCreated()
assert.deepEqual(calls, ['default-launch', 'mod-context'])
observations.push({ id: 'P7', observation: 'MOD defining only onContextCreated inherits the default onLaunch hook', calls })

writeFileSync(resolve(here, 'probes.json'), JSON.stringify({
  commit,
  environment: process.version,
  method: 'Production modules loaded by Node vm.SourceTextModule after Node TypeScript syntax erasure; dependencies replaced by deterministic IO/Timer fakes. These probes do not verify XS scheduling, native driver behavior, or actual hardware.',
  observations,
}, null, 2) + '\n')
console.log(JSON.stringify(observations, null, 2))
