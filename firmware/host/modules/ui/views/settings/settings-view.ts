import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Label as PiuLabel,
  Skin as PiuSkin,
  Style as PiuStyle,
} from 'piu/MC'
import { Column, Container, Label, Skin, Style } from 'piu/MC'
import type { SettingsNetworkEntry } from 'settings-network-list'
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
  scan: PiuLabel
  networks: PiuLabel[]
  networkState: {
    networks: SettingsNetworkEntry[]
  }
  hint: PiuLabel
}

export type SettingsViewOptions = {
  onConnect?: () => void
  onScan?: () => void
  onSelectNetwork?: (network: SettingsNetworkEntry) => void
}

const STATUS_ROW_HEIGHT = 20
const NETWORK_ROW_HEIGHT = 20
const NETWORK_ROW_COUNT = 3
const CONTENT_TOP = 8
const TITLE_ROW_HEIGHT = 26
const STATUS_ROWS_BEFORE_SCAN = 4
const SCAN_TOUCH_TOP = CONTENT_TOP + TITLE_ROW_HEIGHT + STATUS_ROW_HEIGHT * STATUS_ROWS_BEFORE_SCAN
const NETWORK_TOUCH_TOP = SCAN_TOUCH_TOP + STATUS_ROW_HEIGHT
const CONNECT_TOUCH_TOP = NETWORK_TOUCH_TOP + NETWORK_ROW_HEIGHT * NETWORK_ROW_COUNT

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
  const networkState = {
    networks: [] as SettingsNetworkEntry[],
  }
  const labels: SettingsStatusLabels = {
    ble: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    wifi: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    ssid: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    password: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    scan: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    networks: Array.from(
      { length: NETWORK_ROW_COUNT },
      () => new Label(null, { left: 0, right: 0, height: NETWORK_ROW_HEIGHT, style: getLabelStyle() }),
    ),
    networkState,
    hint: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
  }
  application.empty()
  application.skin = getScreenSkin()
  application.add(
    new Container(
      { options, networkState },
      {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        active: true,
        contents: [
          new Column(null, {
            left: 10,
            right: 10,
            top: CONTENT_TOP,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                height: TITLE_ROW_HEIGHT,
                string: 'Stack-chan Setup',
                style: getTitleStyle(),
              }),
              labels.ble,
              labels.ssid,
              labels.password,
              labels.wifi,
              labels.scan,
              ...labels.networks,
              labels.hint,
            ],
          }),
        ],
        Behavior: class extends Behavior {
          options: SettingsViewOptions | null = null
          networkState: { networks: SettingsNetworkEntry[] } = { networks: [] }

          onCreate(
            _container: PiuContainer,
            data: { options: SettingsViewOptions; networkState: { networks: SettingsNetworkEntry[] } },
          ) {
            this.options = data.options
            this.networkState = data.networkState
          }

          onTouchEnded(_container: PiuContainer, _id?: number, _x?: number, y?: number) {
            if (typeof y === 'number') {
              if (y >= SCAN_TOUCH_TOP && y < NETWORK_TOUCH_TOP) {
                this.options?.onScan?.()
                return
              }
              if (y >= NETWORK_TOUCH_TOP && y < CONNECT_TOUCH_TOP) {
                const index = Math.floor((y - NETWORK_TOUCH_TOP) / NETWORK_ROW_HEIGHT)
                const network = this.networkState.networks[index]
                if (network) {
                  this.options?.onSelectNetwork?.(network)
                }
                return
              }
            }
            this.options?.onConnect?.()
          }
        },
      },
    ),
  )
  updateSettingsStatusLabels(labels, status)
  updateSettingsNetworkLabels(labels, [])
  return labels
}

export const updateSettingsStatusLabels = (labels: SettingsStatusLabels, status: SettingsStatus): void => {
  labels.ble.string = `BLE: ${settingsStatusToLabel(status.ble)}`
  labels.ssid.string = `SSID: ${status['wifi.ssid'] || 'not set'}`
  const maskedPassword = status['wifi.password'] ? status['wifi.password'].replace(/./g, '*') : 'not set'
  labels.password.string = `password: ${maskedPassword}`
  labels.wifi.string = `Wi-Fi: ${settingsStatusToLabel(status.wifi)}`
  labels.scan.string = status.wifi === SettingsStatusValue.SCANNING ? 'Scanning Wi-Fi...' : 'Tap here to scan Wi-Fi'
  labels.hint.string = 'Tap to test connection'
}

export const updateSettingsNetworkLabels = (
  labels: SettingsStatusLabels,
  networks: readonly SettingsNetworkEntry[],
): void => {
  const visibleNetworks = networks.slice(0, labels.networks.length)
  for (let index = 0; index < labels.networks.length; index += 1) {
    const network = visibleNetworks[index]
    labels.networks[index].string = network
      ? `${index + 1}. ${network.label}`
      : index === 0
        ? 'No networks scanned'
        : ''
  }
  labels.networkState.networks = visibleNetworks
}
