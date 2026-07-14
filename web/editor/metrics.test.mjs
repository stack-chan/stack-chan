import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { aggregateMetricsFiles, runMetricsAggregateCli } from './aggregate-metrics-cli.mjs'
import { aggregateMetricsReports, createMetricsReport, summarizeMetrics } from './metrics.mjs'

test('metrics report calculates first-loop elapsed time and failures', () => {
  const events = [
    { event: 'editor_opened', at: '2026-01-01T00:00:00.000Z' },
    { event: 'build_failed', at: '2026-01-01T00:00:10.000Z' },
    { event: 'build_succeeded', at: '2026-01-01T00:01:00.000Z' },
    { event: 'simulator_succeeded', at: '2026-01-01T00:02:00.000Z' },
  ]
  assert.deepEqual(summarizeMetrics(events), {
    eventCount: 4,
    firstBuildMs: 60000,
    firstSimulatorMs: 120000,
    firstDeviceMs: null,
    buildFailures: 1,
    deviceFailures: 0,
  })
  assert.equal(createMetricsReport(events).version, 1)
})

test('multiple participant reports aggregate median and 15 minute pass count', () => {
  const report = (firstSimulatorMs, buildFailures = 0) => ({
    ...createMetricsReport([]),
    summary: {
      eventCount: 2,
      firstBuildMs: 1000,
      firstSimulatorMs,
      firstDeviceMs: null,
      buildFailures,
      deviceFailures: 0,
    },
  })
  assert.deepEqual(aggregateMetricsReports([report(60_000), report(120_000, 1), report(1_000_000)]), {
    format: 'tech.stackchan.visual-metrics-aggregate',
    version: 1,
    participantCount: 3,
    simulatorSuccessCount: 3,
    simulatorWithin15MinutesCount: 2,
    firstSimulatorMedianMs: 120_000,
    firstDeviceMedianMs: null,
    buildFailures: 1,
    deviceFailures: 0,
  })
})

test('metrics aggregation CLI reads participant files and emits the aggregate report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-visual-metrics-'))
  try {
    const makeReport = (simulatorAt) =>
      createMetricsReport([
        { event: 'editor_opened', at: '2026-01-01T00:00:00.000Z' },
        { event: 'build_succeeded', at: '2026-01-01T00:01:00.000Z' },
        { event: 'simulator_succeeded', at: simulatorAt },
      ])
    const paths = [join(directory, 'participant-1.json'), join(directory, 'participant-2.json')]
    await Promise.all([
      writeFile(paths[0], JSON.stringify(makeReport('2026-01-01T00:02:00.000Z'))),
      writeFile(paths[1], JSON.stringify(makeReport('2026-01-01T00:20:00.000Z'))),
    ])

    assert.deepEqual(await aggregateMetricsFiles(paths), {
      format: 'tech.stackchan.visual-metrics-aggregate',
      version: 1,
      participantCount: 2,
      simulatorSuccessCount: 2,
      simulatorWithin15MinutesCount: 1,
      firstSimulatorMedianMs: 660_000,
      firstDeviceMedianMs: null,
      buildFailures: 0,
      deviceFailures: 0,
    })

    const output = []
    assert.equal(await runMetricsAggregateCli(paths, { writeOutput: (value) => output.push(value) }), 0)
    assert.equal(JSON.parse(output[0]).participantCount, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('metrics aggregation CLI reports usage when no participant files are supplied', async () => {
  const errors = []
  assert.equal(await runMetricsAggregateCli([], { writeError: (value) => errors.push(value) }), 2)
  assert.match(errors[0], /participant-1\.json/)
})
