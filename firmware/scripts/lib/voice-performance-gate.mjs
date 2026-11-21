const prefix = 'GEMINI_PRESSURE '
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0
const key = ({ mode, size }) => `${mode}/${size}`

function validateSpec(spec) {
  if (!spec || !positiveInteger(spec.runs) || !Array.isArray(spec.cases) || !spec.cases.length)
    throw new TypeError('spec requires positive runs and nonempty cases')
  if (Object.keys(spec).some((field) => !['runs', 'cases'].includes(field))) throw new TypeError('unknown spec field')
  const keys = new Set()
  for (const item of spec.cases) {
    if (!item || typeof item.mode !== 'string' || !item.mode || typeof item.size !== 'string' || !item.size)
      throw new TypeError('case requires mode and size')
    if (!positiveInteger(item.expectedBytes) || keys.has(key(item))) throw new TypeError('invalid or duplicate case')
    if (
      Object.keys(item).some(
        (field) => !['mode', 'size', 'expectedBytes', 'maxElapsedMs', 'maxLagMs', 'minInternalBytes'].includes(field),
      )
    )
      throw new TypeError('unknown case field')
    keys.add(key(item))
    for (const field of ['maxElapsedMs', 'maxLagMs', 'minInternalBytes'])
      if (item[field] !== undefined && (!finite(item[field]) || item[field] < 0))
        throw new TypeError(`invalid ${field}`)
  }
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
  }
}

/** Validate a single capture against an independent fixture specification.
 * Passing byte counts is not a proof of waveform correctness or underrun-free playback.
 * Budgets are supplied by the caller; this module does not infer realtime performance.
 */
export function evaluateVoicePerformance(log, spec) {
  validateSpec(spec)
  const errors = []
  const budgetFailures = []
  const cases = new Map(spec.cases.map((item) => [key(item), { spec: item, samples: new Map() }]))
  let finished = false
  let doneCount = 0
  for (const [index, line] of log.split(/\r?\n/).entries()) {
    const at = line.indexOf(prefix)
    if (at < 0) continue
    let event
    try {
      event = JSON.parse(line.slice(at + prefix.length))
    } catch {
      errors.push(`line ${index + 1}: malformed marker`)
      continue
    }
    if (!event || typeof event !== 'object' || typeof event.phase !== 'string') {
      errors.push(`line ${index + 1}: invalid marker`)
      continue
    }
    if (finished) errors.push(`line ${index + 1}: marker after done`)
    if (event.phase === 'done') {
      doneCount++
      finished = true
      if (event.passed !== true) errors.push('device reported unsuccessful completion')
      continue
    }
    if (['fail', 'fatal', 'reason'].includes(event.phase)) {
      errors.push(`device reported ${event.phase}`)
      continue
    }
    if (['network-ready', 'transport'].includes(event.phase)) continue
    if (event.phase !== 'pass') {
      errors.push(`line ${index + 1}: unknown phase`)
      continue
    }
    const group = cases.get(key(event))
    if (!group || !Number.isSafeInteger(event.run) || event.run < 0 || event.run >= spec.runs) {
      errors.push(`line ${index + 1}: unexpected case or repetition`)
      continue
    }
    const label = `${key(event)} run ${event.run}`
    if (group.samples.has(event.run)) {
      errors.push(`${label}: duplicate result`)
      continue
    }
    if (event.received !== group.spec.expectedBytes || event.expected !== group.spec.expectedBytes)
      errors.push(`${label}: incorrect PCM byte count`)
    if (!positiveInteger(event.calls) || !finite(event.elapsedMs) || event.elapsedMs <= 0)
      errors.push(`${label}: invalid work count or elapsed time`)
    if (!finite(event.maximumLag) || event.maximumLag < 0 || !finite(event.minimum) || event.minimum < 0)
      errors.push(`${label}: invalid lag or memory measurement`)
    group.samples.set(event.run, event)
    for (const [budget, metric, exceeds] of [
      ['maxElapsedMs', 'elapsedMs', (value, limit) => value > limit],
      ['maxLagMs', 'maximumLag', (value, limit) => value > limit],
      ['minInternalBytes', 'minimum', (value, limit) => value < limit],
    ]) {
      const limit = group.spec[budget]
      if (limit !== undefined && finite(event[metric]) && exceeds(event[metric], limit))
        budgetFailures.push(`${label}: ${metric}=${event[metric]} violates ${budget}=${limit}`)
    }
  }
  if (doneCount !== 1) errors.push(`expected one done marker, found ${doneCount}`)
  const summary = []
  for (const [name, { samples }] of cases) {
    if (samples.size !== spec.runs) errors.push(`${name}: expected ${spec.runs} results, found ${samples.size}`)
    const valid = [...samples.values()].filter((item) => finite(item.elapsedMs) && finite(item.maximumLag))
    if (valid.length)
      summary.push({
        case: name,
        runs: valid.length,
        elapsedMs: distribution(valid.map((item) => item.elapsedMs)),
        maximumLagMs: distribution(valid.map((item) => item.maximumLag)),
      })
  }
  const configured = spec.cases.some((item) =>
    ['maxElapsedMs', 'maxLagMs', 'minInternalBytes'].some((field) => item[field] !== undefined),
  )
  return {
    passed: errors.length === 0 && budgetFailures.length === 0,
    validation: errors.length ? 'failed' : 'passed',
    performance: !configured
      ? 'not_checked'
      : errors.length
        ? 'inconclusive'
        : budgetFailures.length
          ? 'failed'
          : 'passed',
    errors,
    budgetFailures,
    summary,
  }
}
