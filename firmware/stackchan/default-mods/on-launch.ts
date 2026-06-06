import { Application, Column, Container, Label, Skin, Style } from 'piu/MC'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import type { StackchanMod } from 'default-mods/mod'
import config from 'mc/config'
import { DOMAIN, PREF_KEYS } from 'consts'
import Timer from 'timer'
import type { Label as PiuLabel } from 'piu/MC'

type Status = {
  ble: string
  wifi: string
  'wifi.ssid'?: string
  'wifi.password'?: string
}

type StatusLabels = {
  ble: PiuLabel
  wifi: PiuLabel
  ssid: PiuLabel
  password: PiuLabel
  hint: PiuLabel
}

const screenSkin = new Skin({ fill: '#000000' })
const titleStyle = new Style({
  font: '20px Open Sans',
  color: '#ffffff',
  horizontal: 'left',
  vertical: 'middle',
})
const labelStyle = new Style({
  font: '16px Open Sans',
  color: '#ffffff',
  horizontal: 'left',
  vertical: 'middle',
})

const buildStatusUI = (status: Status): StatusLabels => {
  const labels: StatusLabels = {
    ble: new Label(null, { left: 0, right: 0, height: 22, style: labelStyle }),
    wifi: new Label(null, { left: 0, right: 0, height: 22, style: labelStyle }),
    ssid: new Label(null, { left: 0, right: 0, height: 22, style: labelStyle }),
    password: new Label(null, { left: 0, right: 0, height: 22, style: labelStyle }),
    hint: new Label(null, { left: 0, right: 0, height: 22, style: labelStyle }),
  }
  new Application(null, {
    displayListLength: 4096,
    skin: screenSkin,
    contents: [
      new Container(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        contents: [
          new Column(null, {
            left: 10,
            right: 10,
            top: 20,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                height: 26,
                string: 'Stack-chan Setup',
                style: titleStyle,
              }),
              labels.ble,
              labels.ssid,
              labels.password,
              labels.wifi,
              labels.hint,
            ],
          }),
        ],
      }),
    ],
  })
  updateStatusLabels(labels, status)
  return labels
}

const updateStatusLabels = (labels: StatusLabels, status: Status): void => {
  labels.ble.string = `BLE: ${status.ble}`
  labels.ssid.string = `SSID: ${status['wifi.ssid'] ?? 'not set'}`
  const maskedPassword = status['wifi.password']?.replace(/./g, '*') ?? 'not set'
  labels.password.string = `password: ${maskedPassword}`
  labels.wifi.string = `Wi-Fi: ${status.wifi}`
  labels.hint.string = 'Press A to test connection'
}

async function waitForKey(): Promise<boolean> {
  interface GlobalEnvironment {
    device?: {
      sensor?: {
        Touch?: unknown
      }
    }
  }
  const globalEnv = globalThis as unknown as GlobalEnvironment
  const Touch = config.Touch || globalEnv.device?.sensor?.Touch
  let isPressed: () => boolean
  // biome-ignore lint/suspicious/noExplicitAny: touch driver of device don't have type
  let touch: any
  if (Touch) {
    touch = new Touch()
    if (touch.sample) {
      // ECMA-419 driver
      isPressed = () => {
        const points = touch.sample()
        return points?.length > 0
      }
    } else {
      touch.points = [{}]
      isPressed = () => {
        touch.read(touch.points)
        const state = touch.points[0].state
        return state === 1 || state === 2
      }
    }
  } else {
    // legacy driver
    isPressed = () => {
      if (!globalThis.button || !globalThis.button.c) {
        return false
      }
      return !globalThis.button.c.read()
    }
  }
  return new Promise((resolve) => {
    let count = 0
    const handle = Timer.repeat(() => {
      if (isPressed()) {
        Timer.clear(handle)
        if (touch && !config.Touch) {
          // CoreS3 async touch driver
          touch.close(() => {
            resolve(true)
          })
        } else {
          resolve(true)
        }
        return
      }
      count++
      if (count >= 10) {
        Timer.clear(handle)
        if (touch && !config.Touch) {
          // CoreS3 async touch driver
          touch.close(() => {
            resolve(false)
          })
        } else {
          resolve(false)
        }
      }
    }, 100)
  })
}

export const onLaunch: StackchanMod['onLaunch'] = async () => {
  const shouldEnter = await waitForKey()
  if (!shouldEnter) {
    return true
  }
  const status: Status = {
    ble: 'not connected',
    wifi: 'not connected',
    'wifi.ssid': String(Preference.get(DOMAIN.wifi, 'ssid')),
    'wifi.password': String(Preference.get(DOMAIN.wifi, 'password')),
  }
  const labels = buildStatusUI(status)

  new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
      status[key] = value
      updateStatusLabels(labels, status)
    },
    onConnected: () => {
      status.ble = 'connected'
      updateStatusLabels(labels, status)
    },
    onDisconnected: () => {
      status.ble = 'not connected'
      updateStatusLabels(labels, status)
    },
    keys: PREF_KEYS,
  })

  let networkService: NetworkService
  if (globalThis.button) {
    globalThis.button.a.onChanged = () => {
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
            updateStatusLabels(labels, status)
          },
          () => {
            trace('connection failed\n')
            status.wifi = 'failed'
            updateStatusLabels(labels, status)
          },
        )
        status.wifi = 'connecting'
        updateStatusLabels(labels, status)
      }
    }
  }
  return false
}
