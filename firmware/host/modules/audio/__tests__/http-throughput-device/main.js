import WiFi from 'embedded:network/interface/wifi'
import config from 'mc/config'
import Timer from 'timer'

const RECEIVE_BUFFER_BYTES = 16384
const protocol = String(config.throughput?.protocol ?? 'http')
const host = String(config.throughput?.host ?? '')
const port = Number(config.throughput?.port ?? 8080)
const path = String(config.throughput?.path ?? '/throughput.bin')
const durationSeconds = Number(config.throughput?.durationSeconds ?? 30)
const ssid = String(config.testWiFi?.ssid ?? '')
const password = String(config.testWiFi?.password ?? '')

let wifi
let client
let request
let statsTimer
let stopTimer
let totalBytes = 0
let intervalBytes = 0
let samples = 0
let startTime = 0
let stopped = false
const receiveBuffer = new Uint8Array(new SharedArrayBuffer(RECEIVE_BUFFER_BYTES))

function stopTest(reason) {
  if (stopped) return
  stopped = true
  if (statsTimer !== undefined) Timer.clear(statsTimer)
  if (stopTimer !== undefined) Timer.clear(stopTimer)
  statsTimer = stopTimer = undefined
  client?.close()
  client = request = undefined
  const elapsed = Math.max(1, Date.now() - startTime)
  const average = Math.floor((totalBytes / elapsed) * 1000)
  trace(
    `[http-throughput] result reason=${reason} elapsed=${elapsed}ms samples=${samples} total=${totalBytes} average=${average}B/s\n`,
  )
}

function startTest() {
  startTime = Date.now()
  trace(
    `[http-throughput] start url=${protocol}://${host}:${port}${path} duration=${durationSeconds}s buffer=${RECEIVE_BUFFER_BYTES}\n`,
  )
  const network = protocol === 'https' ? device.network.https.client : device.network.http.client
  client = new network.io({ ...network, host, port })
  request = client.request({
    path,
    headers: new Map([
      ['accept', '*/*'],
      ['connection', 'close'],
      ['user-agent', 'stack-chan-http-throughput/1.0'],
    ]),
    onHeaders(status, headers) {
      trace(
        `[http-throughput] http status=${status} length=${headers.get('content-length') ?? 'none'} encoding=${headers.get('transfer-encoding') ?? 'none'}\n`,
      )
      if (Math.idiv(status, 100) === 2) return
      stopTest(`http-${status}`)
    },
    onReadable(count) {
      let remaining = count
      while (remaining) {
        const use = Math.min(remaining, receiveBuffer.byteLength)
        this.read(receiveBuffer.subarray(0, use))
        remaining -= use
        intervalBytes += use
        totalBytes += use
      }
    },
    onDone(error) {
      stopTest(error ? `error-${String(error)}` : 'http-done')
    },
  })

  statsTimer = Timer.repeat(() => {
    samples += 1
    trace(`[http-throughput] sample second=${samples} rate=${intervalBytes}B/s total=${totalBytes}\n`)
    intervalBytes = 0
  }, 1000)
  stopTimer = Timer.set(() => stopTest('duration'), durationSeconds * 1000)
}

if (!ssid || !host) throw new Error('testWiFi.ssid and throughput.host config are required')
if (protocol !== 'http' && protocol !== 'https') throw new Error('throughput.protocol must be http or https')

trace(`[http-throughput] connecting ssid=${ssid}\n`)
wifi = new WiFi({
  onChanged() {
    trace(`[http-throughput] wifi=${this.connection}\n`)
    if (this.connection < 500) return
    trace(`[http-throughput] ip=${this.address}\n`)
    this.close()
    wifi = undefined
    startTest()
  },
})
wifi.connect(password ? { SSID: ssid, password, secure: true } : { SSID: ssid })
