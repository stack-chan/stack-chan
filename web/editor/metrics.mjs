export const VISUAL_METRICS_FORMAT = 'tech.stackchan.visual-metrics'
export const VISUAL_METRICS_VERSION = 1

export function summarizeMetrics(events) {
  const first = events.find((event) => event.event === 'editor_opened')
  const elapsed = (target) => {
    if (!first || !target) return null
    return Math.max(0, new Date(target.at).getTime() - new Date(first.at).getTime())
  }
  return {
    eventCount: events.length,
    firstBuildMs: elapsed(events.find((event) => event.event === 'build_succeeded')),
    firstSimulatorMs: elapsed(
      events.find((event) => event.event === 'simulator_succeeded') ??
        events.find((event) => event.event === 'simulator_installed')
    ),
    firstDeviceMs: elapsed(events.find((event) => event.event === 'device_installed')),
    buildFailures: events.filter((event) => event.event === 'build_failed').length,
    deviceFailures: events.filter((event) => event.event === 'device_failed').length,
  }
}

export function createMetricsReport(events, context = {}) {
  return {
    format: VISUAL_METRICS_FORMAT,
    version: VISUAL_METRICS_VERSION,
    exportedAt: new Date().toISOString(),
    context,
    summary: summarizeMetrics(events),
    events,
  }
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function aggregateMetricsReports(reports, { simulatorPassMs = 15 * 60 * 1000 } = {}) {
  const valid = reports.filter(
    (report) =>
      report?.format === VISUAL_METRICS_FORMAT &&
      report.version === VISUAL_METRICS_VERSION &&
      report.summary &&
      Array.isArray(report.events)
  )
  const simulatorTimes = valid.map((report) => report.summary.firstSimulatorMs).filter(Number.isFinite)
  const deviceTimes = valid.map((report) => report.summary.firstDeviceMs).filter(Number.isFinite)
  return {
    format: 'tech.stackchan.visual-metrics-aggregate',
    version: 1,
    participantCount: valid.length,
    simulatorSuccessCount: simulatorTimes.length,
    simulatorWithin15MinutesCount: simulatorTimes.filter((value) => value <= simulatorPassMs).length,
    firstSimulatorMedianMs: median(simulatorTimes),
    firstDeviceMedianMs: median(deviceTimes),
    buildFailures: valid.reduce((sum, report) => sum + report.summary.buildFailures, 0),
    deviceFailures: valid.reduce((sum, report) => sum + report.summary.deviceFailures, 0),
  }
}
