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
