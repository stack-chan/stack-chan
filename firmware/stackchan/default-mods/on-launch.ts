import Poco from 'commodetto/Poco'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import type { StackchanMod } from 'default-mods/mod'
import config from 'mc/config'
import { DOMAIN } from 'consts'
import Timer from 'timer'

type Status = {
  ble: string
  wifi: string
  ssid?: string
  password?: string
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
    ssid: String(Preference.get(DOMAIN, 'ssid')),
    password: String(Preference.get(DOMAIN, 'password')),
  }

  const drawStatus = (status) => {
    render.begin()
    render.fillRectangle(black, 0, 0, render.width, render.height)
    if (status.ble === 'not connected') {
      render.drawText('Waiting BLE...', font, white, 10, 40)
    }
    render.drawText(`SSID: ${status.ssid ?? 'not set'}`, font, white, 10, 80)
    render.drawText(`password: ${status.password?.replace(/./g, '*') ?? 'not set'}`, font, white, 10, 110)
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
    keys: ['ssid', 'password'],
  })

  let networkService
  if (globalThis.button) {
    globalThis.button.a.onChanged = function () {
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
