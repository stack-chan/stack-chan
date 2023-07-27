import WiFi from 'wifi'
import Net from 'net'
import Time from 'time'
import config from 'mc/config'
import SNTP from 'sntp'

const MAX_SCANS = 3
export class NetworkService {
  #ssid?: string
  #password?: string
  #connecting = false
  #connectionEstablished = false
  #retry = 0
  #wifi?: WiFi
  onConnected: () => void
  onError: (reason?: string) => void
  constructor(options) {
    this.#ssid = options.ssid
    this.#password = options.password
  }
  close() {
    this.#wifi?.close()
  }
  connect(onConnected: () => void, onError: (message: string) => void) {
    if (this.#ssid == null) {
      onError('ssid not set')
    }
    this.#connecting = true
    this.#wifi = new WiFi({ ssid: this.#ssid, password: this.#password }, (msg) => {
      trace(`WiFi ${msg}\n`)
      switch (msg) {
        case WiFi.connected:
          trace(`Connected to: ${Net.get('SSID')}\n`)
          break

        case WiFi.gotIP:
          trace(`Got IP address: ${Net.get('IP')}\n`)
          this.#connecting = false
          this.#connectionEstablished = true
          this.#retry = 0

          // Setting time for TLS connection
          if (!config.sntp || Date.now() > 1672722071_000) {
            trace(`Time already configured, skipping\n`)
            onConnected?.()
            break
          }
          new SNTP({ host: config.sntp }, function (message, value) {
            if (SNTP.time === message) {
              trace(`Got time from: ${config.sntp}\n`)
              Time.set(value)
              onConnected?.()
            } else if (SNTP.error === (message as -1 | 1 | 2)) {
              // workaround for the type mistake
              onError?.('Failed to get time')
            }
          })
          break
        case WiFi.disconnected:
          this.#connecting = false
          if (this.#connectionEstablished) {
            this.#connecting = true
            WiFi.connect({ ssid: this.#ssid, password: this.#password })
          } else {
            onError?.('connection failed')
          }
          break
      }
    })
  }
  scanAndConnect(onConnected, onError) {
    WiFi.scan({}, (item: { ssid: string } | null) => {
      if (this.#connecting) {
        return
      }

      if (item != null) {
        if (item.ssid === this.#ssid) {
          this.connect(onConnected, onError)
        }
      } else {
        // scan finished
        this.#retry += 1
        if (this.#retry > MAX_SCANS) {
          trace(`Access point "${this.#ssid}" not found\n`)
          return
        } else {
          trace(`retrying\n`)
          this.scanAndConnect(onConnected, onError)
        }
      }
    })
  }
}
