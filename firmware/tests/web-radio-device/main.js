import WiFi from 'embedded:network/interface/wifi'
import MP3Streamer from 'buffered-mp3streamer'
import Preference from 'preference'
import AudioOut from 'web-radio-audio-out'
import config from 'mc/config'
import Timer from 'timer'

const STREAM_HOSTS = ['ice5.somafm.com', 'ice3.somafm.com']
const STREAM_PATH = '/groovesalad-128-mp3'
const QUIET_VOLUME = 1
let wifi
let audio
let streamer
let playedBuffers = 0
let hostIndex = 0
let reconnectTimer

function peakOf(buffer) {
  const samples = new Int16Array(buffer)
  let peak = 0
  for (let index = 0; index < samples.length; index += 64) {
    const value = Math.abs(samples[index])
    if (value > peak) peak = value
  }
  return peak
}

function startRadio() {
  const host = STREAM_HOSTS[hostIndex]
  hostIndex = (hostIndex + 1) % STREAM_HOSTS.length
  trace(`[web-radio-test] stream=http://${host}${STREAM_PATH}\n`)
  audio = new AudioOut({ streams: 1, bitsPerSample: 16, numChannels: 1, sampleRate: 24000 })
  audio.enqueue(0, AudioOut.Volume, QUIET_VOLUME)
  streamer = new MP3Streamer({
    http: device.network.http,
    host,
    port: 80,
    path: STREAM_PATH,
    audio: { out: audio, stream: 0, sampleRate: 44100 },
    onReady(ready) {
      trace(`[web-radio-test] ready=${ready}\n`)
      if (ready) {
        audio.start()
      }
    },
    onPlayed(buffer) {
      playedBuffers += 1
      if (playedBuffers === 1 || playedBuffers % 32 === 0)
        trace(`[web-radio-test] played=${playedBuffers} peak=${peakOf(buffer)}\n`)
    },
    onError(reason) {
      trace(`[web-radio-test] error=${String(reason)}\n`)
      scheduleReconnect('error')
    },
    onDone() {
      trace('[web-radio-test] done\n')
      scheduleReconnect('done')
    },
  })
}

function scheduleReconnect(reason) {
  if (reconnectTimer !== undefined) return
  trace(`[web-radio-test] reconnect reason=${reason} delay=1000ms\n`)
  reconnectTimer = Timer.set(() => {
    reconnectTimer = undefined
    streamer?.close()
    streamer = undefined
    audio?.stop()
    audio?.close()
    audio = undefined
    startRadio()
  }, 1000)
}

const ssid = config.testWiFi?.ssid ?? Preference.get('wifi', 'ssid')
const password = config.testWiFi?.password ?? Preference.get('wifi', 'password')

if (!ssid || !password) {
  trace('[web-radio-test] missing stored wifi credentials\n')
  throw new Error('missing stored wifi credentials')
}

trace(`[web-radio-test] connecting ssid=${ssid}\n`)
wifi = new WiFi({
  onChanged() {
    trace(`[web-radio-test] wifi=${this.connection}\n`)
    if (this.connection < 500) return
    trace(`[web-radio-test] ip=${this.address}\n`)
    this.close()
    wifi = undefined
    startRadio()
  },
})
wifi.connect({ SSID: String(ssid), password: String(password), secure: true })
