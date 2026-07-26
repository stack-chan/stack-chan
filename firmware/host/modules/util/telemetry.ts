import Time from 'time'

export const TELEMETRY_SCHEMA_VERSION = 1
export const TELEMETRY_TRACE_PREFIX = '@stackchan-telemetry '

const DEFAULT_HISTORY_SIZE = 32
const MAX_REASON_LENGTH = 120

export type TelemetryValue = string | number | boolean
export type TelemetryFields = Record<string, TelemetryValue>

/**
 * One structured telemetry record. Serialized as a single JSON line so that
 * humans (xsbug/serial), CI, and LLM agents can all consume the same output.
 * See docs/specs/log-schema.md for the field and vocabulary contract.
 */
export type TelemetryEvent = {
  /** Schema version of this record */
  v: number
  /** Monotonic sequence number within the emitting channel */
  seq: number
  /** Timestamp in milliseconds since boot */
  t: number
  /** Subsystem that emitted the event, e.g. "tts", "mic", "speaker" */
  mod: string
  /** Event name, e.g. "playback.begin" */
  ev: string
  /** Correlation id shared by all events of one span */
  id?: number
  /** Stable machine-readable error code (E_*) */
  err?: string
  /** Milliseconds elapsed since the owning span began */
  dur?: number
  /** Free memory in bytes, present when a memory sampler is installed */
  mem?: number
  /** Event-specific payload */
  data?: TelemetryFields
}

export type TelemetrySink = (event: TelemetryEvent) => void
export type MemorySampler = () => number

export type TelemetryEmitOptions = {
  id?: number
  err?: string
  dur?: number
  data?: TelemetryFields
}

/**
 * A timed unit of work. `end`/`fail` settle the span exactly once;
 * `mark` records intermediate events sharing the span id.
 */
export type TelemetrySpan = {
  readonly id: number
  elapsed(): number
  mark(ev: string, options?: TelemetryEmitOptions): void
  end(options?: TelemetryEmitOptions): void
  fail(err: string, options?: TelemetryEmitOptions): void
}

export type TelemetryOptions = {
  now?: () => number
  memory?: MemorySampler
  historySize?: number
}

export function truncateReason(reason: string): string {
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}...` : reason
}

export function formatTelemetryLine(event: TelemetryEvent): string {
  return `${TELEMETRY_TRACE_PREFIX}${JSON.stringify(event)}`
}

export function createTraceSink(write?: (line: string) => void): TelemetrySink {
  const emitLine =
    write ??
    ((line: string) => {
      if (typeof trace === 'function') trace(`${line}\n`)
    })
  return (event) => emitLine(formatTelemetryLine(event))
}

export class TelemetryChannel {
  #now: () => number
  #memory: MemorySampler | undefined
  #historySize: number
  #history: TelemetryEvent[]
  #sinks: TelemetrySink[]
  #seq: number

  constructor(options: TelemetryOptions = {}) {
    this.#now = options.now ?? (() => Time.ticks)
    this.#memory = options.memory
    this.#historySize = options.historySize ?? DEFAULT_HISTORY_SIZE
    this.#history = []
    this.#sinks = []
    this.#seq = 0
  }

  now(): number {
    return this.#now()
  }

  setMemorySampler(sampler: MemorySampler | undefined): void {
    this.#memory = sampler
  }

  subscribe(sink: TelemetrySink): () => void {
    this.#sinks.push(sink)
    return () => {
      const index = this.#sinks.indexOf(sink)
      if (index >= 0) this.#sinks.splice(index, 1)
    }
  }

  /** Recent events, oldest first, capped at `historySize` */
  history(): TelemetryEvent[] {
    return this.#history.slice()
  }

  emit(mod: string, ev: string, options: TelemetryEmitOptions = {}): TelemetryEvent {
    this.#seq += 1
    const event: TelemetryEvent = {
      v: TELEMETRY_SCHEMA_VERSION,
      seq: this.#seq,
      t: this.#now(),
      mod,
      ev,
    }
    if (options.id !== undefined) event.id = options.id
    if (options.err !== undefined) event.err = options.err
    if (options.dur !== undefined) event.dur = options.dur
    const mem = this.#memory?.()
    if (mem !== undefined) event.mem = mem
    if (options.data !== undefined) event.data = options.data
    this.#history.push(event)
    if (this.#history.length > this.#historySize) this.#history.shift()
    for (const sink of this.#sinks) {
      try {
        sink(event)
      } catch {
        // a broken sink must never break the instrumented code path
      }
    }
    return event
  }

  begin(mod: string, name: string, data?: TelemetryFields): TelemetrySpan {
    const startedAt = this.#now()
    // the span id doubles as the begin event's own seq for correlation
    const begin = this.emit(mod, `${name}.begin`, { id: this.#seq + 1, data })
    const id = begin.seq
    const channel = this
    let settled = false
    const settle = (ev: string, options: TelemetryEmitOptions): void => {
      if (settled) return
      settled = true
      channel.emit(mod, ev, options)
    }
    return {
      id,
      elapsed(): number {
        return channel.#now() - startedAt
      },
      mark(ev: string, options: TelemetryEmitOptions = {}): void {
        channel.emit(mod, ev, {
          id,
          err: options.err,
          dur: options.dur ?? channel.#now() - startedAt,
          data: options.data,
        })
      },
      end(options: TelemetryEmitOptions = {}): void {
        settle(`${name}.end`, {
          id,
          err: options.err,
          dur: options.dur ?? channel.#now() - startedAt,
          data: options.data,
        })
      },
      fail(err: string, options: TelemetryEmitOptions = {}): void {
        settle(`${name}.fail`, {
          id,
          err,
          dur: options.dur ?? channel.#now() - startedAt,
          data: options.data,
        })
      },
    }
  }
}

let sharedTelemetry: TelemetryChannel | undefined

/**
 * Shared device-wide channel. Created lazily at runtime so the module
 * stays preloadable; the default sink writes JSON lines to `trace`.
 */
export function getTelemetry(): TelemetryChannel {
  if (sharedTelemetry === undefined) {
    sharedTelemetry = new TelemetryChannel()
    sharedTelemetry.subscribe(createTraceSink())
  }
  return sharedTelemetry
}
