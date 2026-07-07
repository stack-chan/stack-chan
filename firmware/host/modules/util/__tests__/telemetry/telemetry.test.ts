import { TELEMETRY_TRACE_PREFIX, TelemetryChannel, createTraceSink, getTelemetry } from 'telemetry'
import { assert, equal } from 'testing/assert'

let now = 0
const channel = new TelemetryChannel({ now: () => now })
const lines: string[] = []
channel.subscribe(createTraceSink((line) => lines.push(line)))

now = 5
const span = channel.begin('tts', 'playback', { engine: 'test' })
now = 25
span.mark('playback.first_audio')
now = 45
span.end({ data: { played: 2 } })
span.fail('E_TTS_ERROR')

const history = channel.history()
equal(history.length, 3, 'span emits begin, mark, and end exactly once')
equal(history[0].ev, 'playback.begin', 'begin event name')
equal(history[0].id, span.id, 'begin event carries the span id')
equal(history[1].dur, 20, 'mark duration')
equal(history[2].ev, 'playback.end', 'end event name')
equal(history[2].dur, 40, 'end duration')

equal(lines.length, 3, 'trace sink received every event')
assert(lines[0].indexOf(TELEMETRY_TRACE_PREFIX) === 0, 'trace lines carry the machine-readable prefix')
const parsed = JSON.parse(lines[2].slice(TELEMETRY_TRACE_PREFIX.length))
equal(parsed.ev, 'playback.end', 'trace lines are valid JSON')
equal(parsed.v, 1, 'schema version')

// the shared channel is created at runtime even though this module is preloaded
const shared = getTelemetry()
assert(shared === getTelemetry(), 'shared channel is a singleton')
shared.emit('tts', 'playback.begin')
equal(shared.history().length, 1, 'shared channel records events')

trace('ok\n')
