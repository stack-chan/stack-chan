export type Scan = { onFound?(item: { ssid: string }): void; onComplete?(): void }
export default class WiFi {
  static readonly availability = 'simulated'
  static instances: WiFi[] = []
  connection = 200
  connects = 0
  disconnects = 0
  closes = 0
  failDisconnect = false
  failClose = false
  scanOptions: Scan[] = []
  #options: { onChanged?(): void }
  constructor(options: { onChanged?(): void }) {
    this.#options = options
    WiFi.instances.push(this)
  }
  connect(_options: unknown) {
    this.connects++
    this.connection = 300
    this.#options.onChanged?.()
  }
  scan(options: Scan) {
    this.scanOptions.push(options)
  }
  disconnect() {
    this.disconnects++
    this.connection = 200
    this.#options.onChanged?.()
    if (this.failDisconnect) throw new Error('disconnect failed')
  }
  close() {
    this.closes++
    if (this.failClose) throw new Error('close failed')
  }
  changed(connection: number) {
    this.connection = connection
    this.#options.onChanged?.()
  }
}
