import Poco from 'commodetto/Poco'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'

const DOMAIN = 'robot'

export function onLaunch() {
  const render = new Poco(globalThis.screen, { rotation: 90, displayListLength: 2048 })
  const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))
  const white = render.makeColor(255, 255, 255)
  const black = render.makeColor(0, 0, 0)
  const status = {
    ssid: Preference.get(DOMAIN, 'ssid'),
    password: Preference.get(DOMAIN, 'password'),
    connection: 'not connected',
  }

  const drawStatus = (status) => {
    render.begin()
    render.fillRectangle(black, 0, 0, render.width, render.height)
    render.drawText(`SSID: ${status.ssid ?? 'not set'}`, font, white, 10, 80)
    render.drawText(`password: ${status.password?.replace(/./g, '*') ?? 'not set'}`, font, white, 10, 110)
    render.drawText(`connection: ${status.connection}`, font, white, 10, 140)
    render.drawText('press A to test connection', font, white, 10, 200)
    render.end()
  }
  drawStatus(status)

  const server = new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
      status[key] = value
      drawStatus(status)
    },
    keys: ['ssid', 'password'],
  })

  let networkService
  if (globalThis.button) {
    button.a.onChanged = function () {
      if (status.ssid.length > 0 && status.password.length > 0) {
        if (networkService != null) {
          networkService.close()
          networkService = null
        }
        networkService = new NetworkService({
          ssid: status.ssid,
          password: status.password,
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
        status.connection = 'connecting'
        drawStatus(status)
      }
    }
  }
  return false
}
