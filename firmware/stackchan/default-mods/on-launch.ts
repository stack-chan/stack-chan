import { Column, Container, Label, Skin, Style } from 'piu/MC'
import type { Application as PiuApplication, Label as PiuLabel } from 'piu/MC'
import { NetworkService } from 'network-service'
import { showStartupSplash } from 'startup-splash'
import { PreferenceServer } from 'preference-server'
import Preference from 'preference'
import type { StackchanMod } from 'default-mods/mod'
import { DOMAIN, PREF_KEYS } from 'consts'
import Timer from 'timer'

type StartupChoice = 'boot' | 'settings'

const STARTUP_AUTO_BOOT_DELAY_MS = 3000

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

let screenSkin: Skin | null = null
let titleStyle: Style | null = null
let labelStyle: Style | null = null

function getScreenSkin() {
  if (!screenSkin) screenSkin = new Skin({ fill: '#000000' })
  return screenSkin
}

function getTitleStyle() {
  if (!titleStyle) {
    titleStyle = new Style({
      font: '20px Open Sans',
      color: '#ffffff',
      horizontal: 'left',
      vertical: 'middle',
    })
  }
  return titleStyle
}

function getLabelStyle() {
  if (!labelStyle) {
    labelStyle = new Style({
      font: '16px Open Sans',
      color: '#ffffff',
      horizontal: 'left',
      vertical: 'middle',
    })
  }
  return labelStyle
}

const buildStatusUI = (application: PiuApplication, status: Status): StatusLabels => {
  const labels: StatusLabels = {
    ble: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    wifi: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    ssid: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    password: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    hint: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
  }
  application.empty()
  application.skin = getScreenSkin()
  application.add(
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
              style: getTitleStyle(),
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
  )
  updateStatusLabels(labels, status)
  return labels
}

const updateStatusLabels = (labels: StatusLabels, status: Status): void => {
  labels.ble.string = `BLE: ${status.ble}`
  labels.ssid.string = `SSID: ${status['wifi.ssid'] || 'not set'}`
  const maskedPassword = status['wifi.password'] ? status['wifi.password'].replace(/./g, '*') : 'not set'
  labels.password.string = `password: ${maskedPassword}`
  labels.wifi.string = `Wi-Fi: ${status.wifi}`
  labels.hint.string = 'Press A to test connection'
}

type StartupChoiceResult = {
  choice: StartupChoice
  application: PiuApplication
}

function waitForStartupChoice(): Promise<StartupChoiceResult> {
  return new Promise((resolve) => {
    let isResolved = false
    let handle: ReturnType<typeof Timer.set> | undefined
    let application: PiuApplication
    const choose = (choice: StartupChoice) => {
      if (isResolved) return
      isResolved = true
      if (handle) Timer.clear(handle)
      resolve({ choice, application })
    }

    application = showStartupSplash({ onTouch: () => Timer.set(() => choose('settings'), 0) })
    handle = Timer.set(() => choose('boot'), STARTUP_AUTO_BOOT_DELAY_MS)
  })
}

const preferenceString = (key: string): string => {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

export const onLaunch: StackchanMod['onLaunch'] = async () => {
  const startupChoice = await waitForStartupChoice()
  if (startupChoice.choice === 'boot') {
    return true
  }
  const status: Status = {
    ble: 'not connected',
    wifi: 'not connected',
    'wifi.ssid': preferenceString('ssid'),
    'wifi.password': preferenceString('password'),
  }
  const labels = buildStatusUI(startupChoice.application, status)

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
