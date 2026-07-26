#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const PREFIX = '[face-rendering-benchmark] '
const EXPECTED_SCENARIOS = [
  'idle',
  'continuous-blink',
  'blink-mouth',
  'emotion-blend',
  'dog-blink-mouth',
  'effects',
]
const TARGET_SCENARIOS = ['continuous-blink', 'blink-mouth']
const MINIMUM_CPU_IMPROVEMENT_PERCENT = 30

function percentile95(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

function parseSamples(path) {
  const records = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const marker = line.indexOf(PREFIX)
    if (marker < 0) continue
    const payload = line.slice(marker + PREFIX.length)
    try {
      const record = JSON.parse(payload)
      if (record.type === 'sample') records.push(record)
    } catch {
      // Debuggers may interleave unrelated output. Ignore incomplete lines.
    }
  }
  if (records.length === 0) {
    throw new Error(`No face-rendering samples found in ${path}`)
  }
  return records
}

function summarize(records) {
  const grouped = new Map()
  for (const record of records) {
    const samples = grouped.get(record.scenario) ?? []
    samples.push(record)
    grouped.set(record.scenario, samples)
  }

  const result = {}
  for (const [scenario, samples] of grouped) {
    const cpuMaximums = samples.map((sample) => Math.max(sample.cpu0 ?? 0, sample.cpu1 ?? 0))
    result[scenario] = {
      samples: samples.length,
      cpuP95: percentile95(cpuMaximums),
      cpu0P95: percentile95(samples.map((sample) => sample.cpu0 ?? 0)),
      cpu1P95: percentile95(samples.map((sample) => sample.cpu1 ?? 0)),
      maximumTickGapMs: Math.max(
        ...samples.map((sample) => sample.maxTickGapMs ?? 0),
      ),
      missedTicks: samples.reduce(
        (total, sample) => total + (sample.missedTicks ?? 0),
        0,
      ),
      garbageCollections: samples.reduce(
        (total, sample) => total + (sample.garbageCollections ?? 0),
        0,
      ),
      maximumPocoDisplayListUsed: Math.max(
        ...samples.map((sample) => sample.pocoDisplayListUsed ?? 0),
      ),
      maximumPiuCommandListUsed: Math.max(
        ...samples.map((sample) => sample.piuCommandListUsed ?? 0),
      ),
      maximumSlotHeapUsed: Math.max(
        ...samples.map((sample) => sample.slotHeapUsed ?? 0),
      ),
      maximumChunkHeapUsed: Math.max(
        ...samples.map((sample) => sample.chunkHeapUsed ?? 0),
      ),
    }
  }
  return result
}

function validateRun(summary) {
  const failures = []
  for (const scenario of EXPECTED_SCENARIOS) {
    if (!summary[scenario]) failures.push(`${scenario}: missing samples`)
  }
  for (const [scenario, values] of Object.entries(summary)) {
    if (values.samples < 30) {
      failures.push(
        `${scenario}: requires at least 30 samples (found ${values.samples})`,
      )
    }
    if (values.missedTicks !== 0) {
      failures.push(`${scenario}: ${values.missedTicks} missed 33 ms ticks`)
    }
    if (values.garbageCollections !== 0) {
      failures.push(
        `${scenario}: ${values.garbageCollections} garbage collections during sampling`,
      )
    }
  }
  for (const scenario of TARGET_SCENARIOS) {
    if (summary[scenario] && summary[scenario].cpuP95 <= 0) {
      failures.push(
        `${scenario}: CPU p95 is zero; instrumentation did not produce a valid sample`,
      )
    }
  }
  return failures
}

function compareRuns(baseline, candidate) {
  const comparisons = {}
  const failures = [
    ...validateRun(baseline).map((failure) => `baseline ${failure}`),
    ...validateRun(candidate).map((failure) => `candidate ${failure}`),
  ]
  for (const scenario of TARGET_SCENARIOS) {
    const before = baseline[scenario]
    const after = candidate[scenario]
    if (!before || !after) {
      failures.push(`${scenario}: missing baseline or candidate samples`)
      continue
    }
    const improvementPercent = before.cpuP95 === 0 ? 0 : ((before.cpuP95 - after.cpuP95) / before.cpuP95) * 100
    comparisons[scenario] = {
      baselineCpuP95: before.cpuP95,
      candidateCpuP95: after.cpuP95,
      improvementPercent,
      targetPercent: MINIMUM_CPU_IMPROVEMENT_PERCENT,
    }
    if (improvementPercent < MINIMUM_CPU_IMPROVEMENT_PERCENT) {
      failures.push(
        `${scenario}: CPU p95 improved ${improvementPercent.toFixed(1)}%, below ${MINIMUM_CPU_IMPROVEMENT_PERCENT}%`,
      )
    }
  }
  return { comparisons, failures }
}

const paths = process.argv.slice(2)
if (paths.length < 1 || paths.length > 2) {
  console.error(
    'Usage: node benchmarks/face-rendering/analyze.mjs <candidate.log>',
  )
  console.error(
    '   or: node benchmarks/face-rendering/analyze.mjs <baseline.log> <candidate.log>',
  )
  process.exit(2)
}

try {
  if (paths.length === 1) {
    const summary = summarize(parseSamples(paths[0]))
    const failures = validateRun(summary)
    console.log(JSON.stringify({ summary, failures }, null, 2))
    if (failures.length > 0) process.exitCode = 1
  } else {
    const baseline = summarize(parseSamples(paths[0]))
    const candidate = summarize(parseSamples(paths[1]))
    const comparison = compareRuns(baseline, candidate)
    console.log(
      JSON.stringify({ baseline, candidate, ...comparison }, null, 2),
    )
    if (comparison.failures.length > 0) process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
