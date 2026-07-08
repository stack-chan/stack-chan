import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Label as PiuLabel,
  Skin as PiuSkin,
  Style as PiuStyle,
} from 'piu/MC'
import { Column, Container, Label, Skin, Style } from 'piu/MC'
import type { SettingsStatus, SettingsStatusValue as SettingsStatusValueModel } from 'settings-status-model'
import {
  SettingsStatusValue as SettingsStatusValueConst,
  settingsStatusToLabel as settingsStatusToLabelImpl,
} from 'settings-status-model'

export const SettingsStatusValue = SettingsStatusValueConst
export const settingsStatusToLabel = settingsStatusToLabelImpl
export type SettingsStatusValue = SettingsStatusValueModel
export type { SettingsStatus }

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
