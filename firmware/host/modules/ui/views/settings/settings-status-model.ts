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
  '未接続',
  '接続済み',
  '接続中',
  'スキャン中',
  '時刻同期中',
  '再接続中',
  '接続失敗',
  '終了',
  '準備完了',
  'オフ',
] as const)

export function settingsStatusToLabel(status: SettingsStatusValue): string {
  return settingsStatusLabels[status] ?? '不明'
}

export type SettingsStatus = {
  ble: SettingsStatusValue
  wifi: SettingsStatusValue
  'wifi.ssid'?: string
  'wifi.password'?: string
}
