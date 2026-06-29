import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Label as PiuLabel,
  Skin as PiuSkin,
  Style as PiuStyle,
} from 'piu/MC'
import { Column, Container, Label, Skin, Style } from 'piu/MC'

export const SettingsStatusValue = Object.freeze({
  NOT_CONNECTED: 0,
  CONNECTED: 1,
  CONNECTING: 2,
  SCANNING: 3,
  SYNCING_TIME: 4,
  RECONNECTING: 5,
  FAILED: 6,
  CLOSED: 7,
  READY: 8,
  OFF: 9,
} as const)

export type SettingsStatusValue = (typeof SettingsStatusValue)[keyof typeof SettingsStatusValue]

const settingsStatusLabels = Object.freeze([
  'not connected',
  'connected',
  'connecting',
  'scanning',
  'syncing time',
  'reconnecting',
  'failed',
  'closed',
  'ready',
  'off',
] as const)

export function settingsStatusToLabel(status: SettingsStatusValue): string {
  return settingsStatusLabels[status] ?? 'unknown'
}

export type SettingsStatus = {
  ble: SettingsStatusValue
  wifi: SettingsStatusValue
  'wifi.ssid'?: string
  'wifi.password'?: string
}

export type SettingsStatusLabels = {
  ble: PiuLabel
  wifi: PiuLabel
  ssid: PiuLabel
  password: PiuLabel
  hint: PiuLabel
}

export type SettingsViewOptions = {
  onConnect?: () => void
}

let screenSkin: PiuSkin | null = null
let titleStyle: PiuStyle | null = null
let labelStyle: PiuStyle | null = null

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

export const buildSettingsView = (
  application: PiuApplication,
  status: SettingsStatus,
  options: SettingsViewOptions = {},
): SettingsStatusLabels => {
  const labels: SettingsStatusLabels = {
    ble: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    wifi: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    ssid: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    password: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    hint: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
  }
  application.empty()
  application.skin = getScreenSkin()
  application.add(
    new Container(options, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
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
      Behavior: class extends Behavior {
        options: SettingsViewOptions | null = null

        onCreate(_container: PiuContainer, data: SettingsViewOptions) {
          this.options = data
        }

        onTouchEnded() {
          this.options?.onConnect?.()
        }
      },
    }),
  )
  updateSettingsStatusLabels(labels, status)
  return labels
}

export const updateSettingsStatusLabels = (labels: SettingsStatusLabels, status: SettingsStatus): void => {
  labels.ble.string = `BLE: ${settingsStatusToLabel(status.ble)}`
  labels.ssid.string = `SSID: ${status['wifi.ssid'] || 'not set'}`
  const maskedPassword = status['wifi.password'] ? status['wifi.password'].replace(/./g, '*') : 'not set'
  labels.password.string = `password: ${maskedPassword}`
  labels.wifi.string = `Wi-Fi: ${settingsStatusToLabel(status.wifi)}`
  labels.hint.string = 'Tap to test connection'
}
