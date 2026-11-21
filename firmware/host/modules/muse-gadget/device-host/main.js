import WiFi from 'embedded:network/interface/wifi'
import { onClose, onContextCreated } from 'guruguru-muse-mod'
import silenceWifiLogs from 'muse-wifi-privacy'
import { Application, Behavior, Label, Skin, Style, Text } from 'piu/MC'
import Preference from 'preference'
import { createAudioRuntime } from 'stackchan/voice/device'
import Time from 'time'

const presence = {},
  missing = []
for (const [domain, keys] of [['muse', ['host', 'vmId', 'token', 'appId', 'nodeId']]]) {
  for (const key of keys) {
    const value = Preference.get(domain, key)
    const present = typeof value === 'string' && value.length > 0
    presence[`${domain}.${key}`] = present
    if (!present) missing.push(`${domain}.${key}`)
  }
}
let wifiDomain
for (const domain of ['wifi', 'alloywifi']) {
  const ssid = Preference.get(domain, 'ssid')
  const password = Preference.get(domain, 'password')
  if (typeof ssid === 'string' && ssid.length > 0 && typeof password === 'string' && password.length > 0) {
    wifiDomain = domain
    break
  }
}
presence['wifi.ssid'] = presence['wifi.password'] = !!wifiDomain
if (!wifiDomain) missing.push('wifi.ssid', 'wifi.password')
trace(`MUSE_HOST preference_presence ${JSON.stringify(presence)}\n`)
let wifi,
  ntp,
  ready = false,
  disposed = false
let audioOwned = false
const audio = createAudioRuntime({
  volume: 0.25,
  acquireExclusive() {
    if (audioOwned) throw new Error('audio busy')
    audioOwned = true
    return () => {
      audioOwned = false
    }
  },
})
const textStyle = new Style({ font: '18px Open Sans', color: 'white', horizontal: 'center' })
const status = new Text(null, { left: 75, right: 75, top: 42, height: 74, style: textStyle, string: 'Starting...' })
const show = (value) => {
  if (!disposed) status.string = String(value).slice(0, 160)
}
const robot = {
  input: { button: { a: {}, b: {} } },
  audio: { microphone: audio.microphone, speaker: audio.speaker, volume: 0.25 },
  ui: {
    addEffect(content) {
      application.add(content)
    },
    removeEffect(content) {
      application.remove(content)
    },
    showBalloon: show,
  },
}
class ButtonBehavior extends Behavior {
  onCreate(_content, data) {
    this.button = data.button
    this.pressed = false
  }
  onTouchBegan(content, id, x, y, ticks) {
    content.captureTouch(id, x, y, ticks)
    if (this.button === 'a' && !ready) return
    this.pressed = true
    content.state = 1
    robot.input.button[this.button].onEvent?.({ pressed: true })
  }
  onTouchEnded(content) {
    content.state = 0
    if (!this.pressed) return
    this.pressed = false
    robot.input.button[this.button].onEvent?.({ pressed: false })
  }
  onTouchCancelled(content) {
    this.onTouchEnded(content)
  }
}
class HostBehavior extends Behavior {
  onQuit() {
    void shutdown()
  }
}
async function shutdown() {
  if (disposed) return
  disposed = true
  ready = false
  ntp?.close()
  ntp = undefined
  wifi?.close()
  wifi = undefined
  await onClose()
}
const application = new Application(null, {
  displayListLength: 4096,
  touchCount: 1,
  Behavior: HostBehavior,
})
globalThis.application = application
onContextCreated(robot)
application.add(status)
const buttonSkin = new Skin({ fill: ['#24585d', '#3a8b91'] })
for (const [button, left, width, string] of [
  ['a', 78, 176, 'Hold to talk'],
  ['b', 270, 112, 'End call'],
]) {
  application.add(
    new Label(
      { button },
      {
        left,
        width,
        bottom: 58,
        height: 62,
        string,
        skin: buttonSkin,
        style: textStyle,
        active: true,
        Behavior: ButtonBehavior,
      },
    ),
  )
}
function syncTime() {
  if (ntp || disposed) return
  show('Wi-Fi connected. Syncing time...')
  try {
    const provider = device.network.ntp.client
    const client = new provider.io({ ...provider, servers: ['pool.ntp.org'] })
    ntp = client
    client.getTime((error, value) => {
      if (disposed || ntp !== client) return
      ntp = undefined
      client.close()
      if (error || typeof value !== 'number' || !Number.isFinite(value)) {
        show('Time sync failed. No Muse connection started.')
        trace('MUSE_HOST time_sync_failed\n')
        return
      }
      Time.set(value / 1000)
      ready = true
      show('Ready. Hold to talk; release to listen.')
      trace('MUSE_HOST network_and_time_ready\n')
    })
  } catch {
    ntp?.close()
    ntp = undefined
    show('Time sync unavailable. No Muse connection started.')
    trace('MUSE_HOST time_sync_unavailable\n')
  }
}
if (missing.length) show(`Missing settings: ${missing.join(', ')}`)
else {
  show('Connecting stored Wi-Fi...')
  try {
    silenceWifiLogs()
    wifi = new WiFi({
      onChanged() {
        if (disposed) return
        if (this.connection >= 500) syncTime()
        else {
          ready = false
          ntp?.close()
          ntp = undefined
          robot.input.button.b.onEvent?.({ pressed: true })
          show('Wi-Fi is not ready.')
        }
      },
    })
    wifi.connect({
      SSID: Preference.get(wifiDomain, 'ssid'),
      password: Preference.get(wifiDomain, 'password'),
      secure: true,
    })
  } catch {
    wifi?.close()
    wifi = undefined
    show('Wi-Fi setup failed. No Muse connection started.')
    trace('MUSE_HOST wifi_setup_failed\n')
  }
}
