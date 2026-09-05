export type ServoBusErrorCode = 'INVALID_ARGUMENT' | 'BUSY' | 'TIMEOUT' | 'CLOSED' | 'IO' | 'CONFIG'

export class ServoBusError extends Error {
  constructor(
    readonly code: ServoBusErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export class CommandTimeoutError extends ServoBusError {
  constructor(
    readonly protocol: string,
    readonly timeoutMs: number,
  ) {
    super('TIMEOUT', `${protocol} command timed out after ${timeoutMs}ms; reinitialize the servo bus`)
  }
}

export type ServoSerialConfig = { port: number; receive: number; transmit: number; baud: number }
export type ServoBusConfig = ServoSerialConfig & { protocol: string }
export type ServoTransport = { format: string; write: (packet: Uint8Array) => void; close: () => void }
export type ServoClock = { set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
export type ServoCommand = {
  encode: (id: number) => Uint8Array
  timeoutMs: number
  waitForResponse?: boolean
  onResult: (payload: Uint8Array | undefined) => void
  onError: (error: unknown) => void
}
type Entry = {
  owner: ServoEndpoint
  command: ServoCommand
  timer?: unknown
  ready: boolean
  payload?: Uint8Array
}
type TransportFactory = (receive: (id: number, payload: Uint8Array) => void) => ServoTransport

function integer(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ServoBusError('INVALID_ARGUMENT', `${name} must be an integer in ${min}..${max}`)
  }
}

/** One registry per runtime, shared by every serial servo protocol. */
export class ServoBusRegistry {
  #ports = new Map<number, ServoBus>()
  constructor(
    private clock: ServoClock,
    private report: (error: unknown) => void = () => {},
  ) {}

  acquire(config: ServoBusConfig, id: number, maxId: number, create: TransportFactory): ServoEndpoint {
    integer(id, 'servo id', 0, maxId)
    integer(config.port, 'serial port', 0)
    integer(config.receive, 'serial receive pin', 0)
    integer(config.transmit, 'serial transmit pin', 0)
    integer(config.baud, 'serial baud', 1)
    const signature = `${config.protocol}:${config.receive}:${config.transmit}:${config.baud}`
    let bus = this.#ports.get(config.port)
    if (bus && bus.signature !== signature) {
      throw new ServoBusError('CONFIG', `UART ${config.port} is already owned with different pins, baud or protocol`)
    }
    if (!bus) {
      bus = new ServoBus(config, signature, this.clock, this.report, () => this.#ports.delete(config.port))
      // Reserve before acquiring IO. A failed close leaves a tombstone: do not reopen
      // a UART whose previous transport could still own the hardware.
      this.#ports.set(config.port, bus)
      try {
        bus.open(create)
      } catch (error) {
        this.#ports.delete(config.port)
        throw error
      }
    }
    return bus.acquire(id, maxId)
  }

  assertUnused(port: number): void {
    if (this.#ports.has(port)) throw new ServoBusError('BUSY', `close all owners of UART ${port} first`)
  }
}

class ServoBus {
  #transport?: ServoTransport
  #owners = new Map<number, ServoEndpoint>()
  #queue: Entry[] = []
  #active?: Entry
  #tick?: unknown
  #fault?: unknown
  #closed = false
  // At most eight waiting commands plus one transaction on the wire.
  static readonly capacity = 8
  static readonly waitTimeoutMs = 5_000

  constructor(
    private config: ServoBusConfig,
    readonly signature: string,
    private clock: ServoClock,
    private report: (error: unknown) => void,
    private released: () => void,
  ) {}

  open(create: TransportFactory): void {
    this.#transport = create((id, payload) => this.#receive(id, payload))
  }

  assertOpen(): void {
    if (this.#fault) throw this.#fault
    if (this.#closed || !this.#transport) throw new ServoBusError('CLOSED', 'servo bus is closed')
  }

  acquire(id: number, maxId: number): ServoEndpoint {
    this.assertOpen()
    if (this.#owners.has(id)) throw new ServoBusError('BUSY', `servo id ${id} is already owned`)
    const owner = new ServoEndpoint(this, id, maxId)
    this.#owners.set(id, owner)
    return owner
  }

  reserve(owner: ServoEndpoint, id: number): void {
    this.assertOpen()
    if (this.#active?.owner === owner || this.#queue.some((entry) => entry.owner === owner)) {
      throw new ServoBusError('BUSY', 'finish pending commands before changing servo id')
    }
    if (this.#owners.has(id)) throw new ServoBusError('BUSY', `servo id ${id} is already owned`)
    this.#owners.set(id, owner)
  }

  discardAliases(owner: ServoEndpoint): void {
    for (const [id, candidate] of this.#owners) {
      if (candidate === owner && id !== owner.id) this.#owners.delete(id)
    }
  }

  enqueue(owner: ServoEndpoint, command: ServoCommand): boolean {
    let entry: Entry | undefined
    try {
      this.assertOpen()
      integer(command.timeoutMs, 'command timeout ms', 1, 60_000)
      if (this.#queue.length >= ServoBus.capacity) throw new ServoBusError('BUSY', 'servo bus queue is full')
      entry = { owner, command, ready: false }
      const pending = entry
      entry.timer = this.clock.set(() => this.#expireWaiting(pending), ServoBus.waitTimeoutMs)
    } catch (error) {
      this.notifyError(command, error instanceof Error ? error : new ServoBusError('IO', String(error)))
      return false
    }
    this.#queue.push(entry)
    this.#schedule()
    return true
  }

  #expireWaiting(entry: Entry): void {
    const index = this.#queue.indexOf(entry)
    if (index < 0) return
    entry.timer = undefined
    this.#queue.splice(index, 1)
    this.notifyError(entry.command, new ServoBusError('TIMEOUT', 'servo command expired before transmission'))
  }

  #clearEntry(entry: Entry): void {
    if (entry.timer === undefined) return
    this.clock.clear(entry.timer)
    entry.timer = undefined
  }

  #clearTick(): void {
    if (this.#tick === undefined) return
    this.clock.clear(this.#tick)
    this.#tick = undefined
  }

  #schedule(delay = 0): void {
    if (this.#tick !== undefined || this.#closed || this.#fault) return
    if (this.#active && !this.#active.ready) return
    if (!this.#active && !this.#queue.length) return
    try {
      this.#tick = this.clock.set(() => {
        this.#tick = undefined
        this.#advance()
      }, delay)
    } catch (error) {
      this.#fail(new ServoBusError('IO', `cannot schedule servo bus: ${String(error)}`))
    }
  }

  #advance(): void {
    if (this.#closed || this.#fault) return
    if (this.#active?.ready) {
      const completed = this.#active
      this.#active = undefined
      try {
        completed.command.onResult(completed.payload)
      } catch (error) {
        this.report(error)
      }
      this.#schedule()
      return
    }
    if (this.#active) return
    const entry = this.#queue.shift()
    if (!entry) return
    this.#clearEntry(entry)
    this.#active = entry
    let packet: Uint8Array
    try {
      packet = entry.command.encode(entry.owner.id)
    } catch (error) {
      this.#active = undefined
      this.notifyError(entry.command, error instanceof Error ? error : new ServoBusError('IO', String(error)))
      this.#schedule()
      return
    }
    const serial = this.#transport
    const format = serial.format
    try {
      // Arm before write: a response may arrive within the transport's write call.
      entry.timer = this.clock.set(() => {
        entry.timer = undefined
        if (this.#active === entry) this.#fail(new CommandTimeoutError(this.config.protocol, entry.command.timeoutMs))
      }, entry.command.timeoutMs)
      serial.format = 'buffer'
      try {
        serial.write(packet)
      } finally {
        serial.format = format
      }
      if (entry.command.waitForResponse === false && this.#active === entry) {
        this.#clearEntry(entry)
        entry.ready = true
        // A no-response completion means transmission admission, not physical arrival.
        this.#schedule(Math.ceil((packet.length * 10_000) / this.config.baud) + 1)
      }
    } catch (error) {
      this.#fail(new ServoBusError('IO', `servo transmission failed: ${String(error)}; reinitialize the servo bus`))
    }
  }

  #receive(id: number, payload: Uint8Array): void {
    const entry = this.#active
    if (this.#closed || this.#fault || !entry || entry.ready || entry.command.waitForResponse === false) return
    if (this.#owners.get(id) !== entry.owner) return
    this.#clearEntry(entry)
    entry.ready = true
    entry.payload = payload
    // Never execute client code from Serial.onReadable or recursively dispatch.
    this.#schedule()
  }

  notifyError(command: ServoCommand, error: unknown): void {
    try {
      command.onError(error)
    } catch (callbackError) {
      this.report(callbackError)
    }
  }

  #fail(error: unknown): void {
    if (this.#fault || this.#closed) return
    const entries = this.#faultEntries(error)
    for (const entry of entries) this.notifyError(entry.command, error)
  }

  #faultEntries(error: unknown): Entry[] {
    this.#fault = error
    this.#clearTick()
    const entries = this.#active ? [this.#active, ...this.#queue] : this.#queue
    this.#active = undefined
    this.#queue = []
    for (const entry of entries) this.#clearEntry(entry)
    return entries
  }

  release(owner: ServoEndpoint): void {
    const error = new ServoBusError(
      'CLOSED',
      'servo endpoint is closed; an interrupted transaction requires bus reinitialization',
    )
    for (const [id, candidate] of this.#owners) {
      if (candidate === owner) this.#owners.delete(id)
    }
    // Cancelling a transmitted request cannot retract its response. Keep the bus
    // faulted until all owners close; a later request must not consume that response.
    const cancelled =
      this.#active?.owner === owner && (!this.#active.ready || this.#active.command.waitForResponse === false)
        ? this.#faultEntries(error)
        : this.#queue.filter((entry) => entry.owner === owner)
    this.#queue = this.#queue.filter((entry) => entry.owner !== owner)
    if (this.#active?.owner === owner) {
      cancelled.unshift(this.#active)
      this.#active = undefined
      this.#clearTick()
    }
    for (const entry of cancelled) this.#clearEntry(entry)
    if (!this.#owners.size) {
      this.#closed = true
      this.#clearTick()
      const serial = this.#transport
      this.#transport = undefined
      try {
        serial.close()
        this.released()
      } finally {
        for (const entry of cancelled) this.notifyError(entry.command, error)
      }
      return
    }
    for (const entry of cancelled) this.notifyError(entry.command, error)
    this.#schedule()
  }
}

export class ServoEndpoint {
  #closed = false
  #change?: ServoIdChange
  constructor(
    private bus: ServoBus,
    private currentId: number,
    private maxId: number,
  ) {}
  get id(): number {
    return this.currentId
  }

  send(command: ServoCommand, change?: ServoIdChange): boolean {
    if (this.#closed || (this.#change && this.#change !== change)) {
      this.bus.notifyError(
        command,
        new ServoBusError(this.#closed ? 'CLOSED' : 'BUSY', 'servo endpoint is unavailable'),
      )
      return false
    }
    return this.bus.enqueue(this, command)
  }

  beginIdChange(id: number): ServoIdChange {
    if (this.#closed) throw new ServoBusError('CLOSED', 'servo endpoint is closed')
    if (this.#change) throw new ServoBusError('BUSY', 'servo id change is in progress')
    integer(id, 'servo id', 0, this.maxId)
    this.bus.reserve(this, id)
    this.#change = new ServoIdChange(this, id)
    return this.#change
  }

  commitId(change: ServoIdChange, id: number): void {
    if (this.#closed || this.#change !== change) throw new ServoBusError('CLOSED', 'servo id change is closed')
    this.currentId = id
  }

  finishIdChange(change: ServoIdChange): void {
    if (this.#change !== change) return
    this.#change = undefined
    this.bus.discardAliases(this)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#change = undefined
    this.bus.release(this)
  }
}

export class ServoIdChange {
  #closed = false
  constructor(
    private owner: ServoEndpoint,
    private id: number,
  ) {}
  send(command: ServoCommand): boolean {
    if (this.#closed) {
      command.onError(new ServoBusError('CLOSED', 'servo id change is closed'))
      return false
    }
    return this.owner.send(command, this)
  }
  commit(): void {
    if (this.#closed) throw new ServoBusError('CLOSED', 'servo id change is closed')
    this.owner.commitId(this, this.id)
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.owner.finishIdChange(this)
  }
}
