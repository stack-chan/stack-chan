import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateVoicePerformance } from './voice-performance-gate.mjs'

const spec = { runs: 2, cases: [{ mode: 'full', size: 'short', expectedBytes: 57600 }] }
const sample = (run, elapsedMs = 1500) => ({
  phase: 'pass',
  mode: 'full',
  size: 'short',
  run,
  expected: 57600,
  received: 57600,
  calls: 60,
  elapsedMs,
  maximumLag: 20,
  minimum: 40000,
})
const encode = (events) => events.map((event) => `GEMINI_PRESSURE ${JSON.stringify(event)}`).join('\n')
const complete = (events = [sample(0, 1400), sample(1, 1600)]) => encode([...events, { phase: 'done', passed: true }])

test('reports repetitions and spread without claiming unconfigured performance', () => {
  const result = evaluateVoicePerformance(`boot\n${complete()}\nserial released`, spec)
  assert.equal(result.passed, true)
  assert.equal(result.validation, 'passed')
  assert.equal(result.performance, 'not_checked')
  assert.deepEqual(result.summary[0].elapsedMs, { median: 1500, min: 1400, max: 1600 })
  assert.equal(result.summary[0].runs, 2)
})

test('rejects empty, truncated, duplicated, and failed captures', () => {
  for (const log of [
    '',
    encode([sample(0), sample(1)]),
    complete([sample(0)]),
    complete([sample(0), sample(0)]),
    complete([{ ...sample(0), phase: 'fail' }, sample(1)]),
    `${complete()}\n${encode([{ phase: 'fatal' }])}`,
    encode([sample(0), sample(1), { phase: 'done', passed: false }]),
    `${complete()}\n${encode([{ phase: 'done', passed: true }])}`,
  ])
    assert.equal(evaluateVoicePerformance(log, spec).passed, false, log)
})

test('does not trust matching device expected/received values that differ from fixture', () => {
  const result = evaluateVoicePerformance(complete([{ ...sample(0), expected: 42, received: 42 }, sample(1)]), spec)
  assert.equal(result.validation, 'failed')
})

test('rejects a missing or unexpected case, repetition, or zero work', () => {
  for (const change of [{ mode: 'decode-only' }, { size: 'long' }, { run: 2 }, { run: -1 }, { calls: 0 }])
    assert.equal(evaluateVoicePerformance(complete([{ ...sample(0), ...change }, sample(1)]), spec).passed, false)
  const matrix = { ...spec, cases: [...spec.cases, { mode: 'decode-only', size: 'short', expectedBytes: 57600 }] }
  assert.equal(evaluateVoicePerformance(complete(), matrix).passed, false)
})

test('validates all timing and memory values rather than silently accepting missing metrics', () => {
  for (const change of [
    { elapsedMs: 0 },
    { elapsedMs: null },
    { elapsedMs: '1500' },
    { maximumLag: -1 },
    { maximumLag: null },
    { minimum: null },
    { minimum: -1 },
    { calls: 1.5 },
  ])
    assert.equal(evaluateVoicePerformance(complete([{ ...sample(0), ...change }, sample(1)]), spec).passed, false)
})

test('explicit budgets apply to every run, including an outlier hidden by a median', () => {
  const budgeted = { ...spec, cases: [{ ...spec.cases[0], maxElapsedMs: 1500, maxLagMs: 20, minInternalBytes: 40000 }] }
  const failed = evaluateVoicePerformance(complete([sample(0, 500), sample(1, 1501)]), budgeted)
  assert.equal(failed.validation, 'passed')
  assert.equal(failed.performance, 'failed')
  assert.equal(failed.passed, false)
  assert.equal(failed.budgetFailures.length, 1)
  assert.equal(evaluateVoicePerformance(complete([sample(0), sample(1)]), budgeted).performance, 'passed')
  for (const change of [{ maximumLag: 21 }, { minimum: 39999 }])
    assert.equal(
      evaluateVoicePerformance(complete([{ ...sample(0), ...change }, sample(1)]), budgeted).performance,
      'failed',
    )
})

test('a malformed or failing capture never receives a performance pass', () => {
  const budgeted = { ...spec, cases: [{ ...spec.cases[0], maxElapsedMs: 2000 }] }
  for (const marker of ['{', 'null', '{}', '{"phase":"unexpected"}', '{"phase":"reason","reason":11}']) {
    const result = evaluateVoicePerformance(`GEMINI_PRESSURE ${marker}\n${complete()}`, budgeted)
    assert.equal(result.performance, 'inconclusive')
    assert.equal(result.passed, false)
  }
})

test('ignores unrelated serial output and accepted transport diagnostics', () => {
  const log = encode([{ phase: 'network-ready' }, { phase: 'transport', values: [0, 200] }])
  assert.equal(evaluateVoicePerformance(`${log}\n${complete()}`, spec).passed, true)
})

test('invalid budgets or ambiguous fixture matrices fail before evaluating a log', () => {
  for (const invalid of [
    null,
    { ...spec, runs: 0 },
    { ...spec, cases: [] },
    { ...spec, cases: [spec.cases[0], spec.cases[0]] },
    { ...spec, cases: [{ ...spec.cases[0], maxLagMs: '20' }] },
    { ...spec, cases: [{ ...spec.cases[0], maxElapsedMs: Infinity }] },
    { ...spec, cases: [{ ...spec.cases[0], maxElaspedMs: 1000 }] },
  ])
    assert.throws(() => evaluateVoicePerformance(complete(), invalid), TypeError)
})

test('CLI exits nonzero on missing captures and budget failures, not on validated samples', () => {
  const directory = mkdtempSync(join(tmpdir(), 'voice-gate-'))
  const capture = join(directory, 'capture.log')
  const config = join(directory, 'spec.json')
  const cli = fileURLToPath(new URL('../check-voice-performance.mjs', import.meta.url))
  try {
    writeFileSync(config, JSON.stringify(spec))
    writeFileSync(capture, complete())
    const pass = spawnSync(process.execPath, [cli, capture, config], { encoding: 'utf8' })
    assert.equal(pass.status, 0, pass.stderr)
    assert.equal(JSON.parse(pass.stdout).performance, 'not_checked')
    writeFileSync(config, JSON.stringify({ ...spec, cases: [{ ...spec.cases[0], maxElapsedMs: 1000 }] }))
    const fail = spawnSync(process.execPath, [cli, capture, config], { encoding: 'utf8' })
    assert.equal(fail.status, 1, fail.stderr)
    assert.equal(JSON.parse(fail.stdout).performance, 'failed')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
