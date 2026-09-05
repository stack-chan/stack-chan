type Options = { port: number; format: string; onReadable: (this: Serial, count: number) => void }
export let serials: Serial[]
export let openPorts: Map<number, Serial>
export function resetSerials(): void {
  serials = []
  openPorts = new Map()
}

export default class Serial {
  format: string
  writes: Uint8Array[] = []
  closes = 0
  reads = 0
  onWrite?: (packet: Uint8Array) => void
  #bytes: number[] = []
  constructor(readonly options: Options) {
    if (openPorts.has(options.port)) throw new Error('UART already acquired')
    this.format = options.format
    serials.push(this)
    openPorts.set(options.port, this)
  }
  write(packet: Uint8Array): void {
    if (this.closes) throw new Error('write after close')
    if (this.format !== 'buffer') throw new Error('wrong write format')
    this.writes.push(packet.slice())
    this.onWrite?.(packet)
  }
  read(): number {
    this.reads++
    return this.#bytes.shift()
  }
  emit(packet: Uint8Array): void {
    this.#bytes.push(...packet)
    this.options.onReadable.call(this, packet.length)
  }
  close(): void {
    this.closes++
    openPorts.delete(this.options.port)
  }
}
