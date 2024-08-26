import Poco from 'commodetto/Poco'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import config from 'mc/config'
import { DOMAIN, PREF_KEYS } from 'consts'

export function onLaunch() {
  const render = new Poco(screen, { rotation: config.rotation, displayListLength: 2048 })
  const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))
  const white = render.makeColor(255, 255, 255)
  const black = render.makeColor(0, 0, 0)
  const status = {
    ble: 'not connected',
    wifi: 'not connected',
    'wifi.ssid': String(Preference.get(DOMAIN.wifi, 'ssid')),
    'wifi.password': String(Preference.get(DOMAIN.wifi, 'password')),
  }

  const drawStatus = (status) => {
    render.begin()
    render.fillRectangle(black, 0, 0, render.width, render.height)
    if (status.ble === 'not connected') {
      render.drawText('Waiting BLE...', font, white, 10, 40)
    }
    render.drawText(`SSID: ${status['wifi.ssid'] ?? 'not set'}`, font, white, 10, 80)
    render.drawText(`password: ${status['wifi.password']?.replace(/./g, '*') ?? 'not set'}`, font, white, 10, 110)
    render.drawText(`connection: ${status.wifi}`, font, white, 10, 140)
    render.drawText('press A to test connection', font, white, 10, 200)
    render.end()
  }
  drawStatus(status)

  new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
      status[key] = value
      drawStatus(status)
    },
    onConnected: () => {
      status.ble = 'connected'
      drawStatus(status)
    },
    onDisconnected: () => {
      status.ble = 'not connected'
      drawStatus(status)
    },
    keys: PREF_KEYS,
  })

  let networkService
  if (globalThis.button) {
    button.a.onChanged = function () {
      if (status['wifi.ssid'].length > 0 && status['wifi.password'].length > 0) {
        if (networkService != null) {
          networkService.close()
          networkService = null
        }
        networkService = new NetworkService({
          ssid: status['wifi.ssid'],
          password: status['wifi.password'],
        })
        networkService.connect(
          () => {
            trace('connection complete\n')
            status.connection = 'connected'
            drawStatus(status)
          },
          () => {
            trace('connection failed\n')
            status.connection = 'failed'
            drawStatus(status)
          }
        )
        status.wifi = 'connecting'
        drawStatus(status)
      }
    }
  }
  return false
}
