import Poco from 'commodetto/Poco'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import type { StackchanMod } from 'default-mods/mod'
import config from 'mc/config'
import { DOMAIN, PREF_KEYS } from 'consts'
import Timer from 'timer'

type Status = {
  ble: string
  wifi: string
  'wifi.ssid'?: string
  'wifi.password'?: string
}

async function waitForKey(): Promise<boolean> {
  let isPressed
  if (config.Touch) {
    const touch = new config.Touch()
    touch.points = [{}]
    isPressed = () => {
      touch.read(touch.points)
      const state = touch.points[0].state
      return state === 1 || state === 2
    }
  } else {
    isPressed = () => {
      return !globalThis.button.c.read()
    }
  }
  return new Promise((resolve) => {
    let count = 0
    const handle = Timer.repeat(() => {
      if (isPressed()) {
        Timer.clear(handle)
        resolve(true)
      }
      count++
      if (count >= 10) {
        Timer.clear(handle)
        resolve(false)
      }
    }, 100)
  })
}

export const onLaunch: StackchanMod['onLaunch'] = async () => {
  const shouldEnter = await waitForKey()
  if (!shouldEnter) {
    return
  }
  const render = new Poco(screen, { rotation: config.rotation, displayListLength: 2048 })
  const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))
  const white = render.makeColor(255, 255, 255)
  const black = render.makeColor(0, 0, 0)
  const status: Status = {
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
    globalThis.button.a.onChanged = function () {
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
            status.wifi = 'connected'
            drawStatus(status)
          },
          () => {
            trace('connection failed\n')
            status.wifi = 'failed'
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
