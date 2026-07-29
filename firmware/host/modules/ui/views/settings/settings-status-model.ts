import { localize } from 'localization'

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
  'status.notConnected',
  'status.connected',
  'status.connecting',
  'status.scanning',
  'status.syncingTime',
  'status.reconnecting',
  'status.failed',
  'status.closed',
  'status.ready',
  'status.off',
] as const)

export function settingsStatusToLabel(status: SettingsStatusValue): string {
  return localize(settingsStatusLabels[status] ?? 'status.unknown')
}

export type SettingsStatus = {
  ble: SettingsStatusValue
  wifi: SettingsStatusValue
  'wifi.ssid'?: string
  'wifi.password'?: string
  'ui.language'?: string
  'time.timezone'?: string
}
