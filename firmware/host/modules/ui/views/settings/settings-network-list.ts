import type { RawWiFiScanResult } from '../../../connectivity/wifi-scan-types.js'

export type { RawWiFiScanResult } from '../../../connectivity/wifi-scan-types.js'

export type SettingsNetworkEntry = {
  ssid: string
  signal?: number
  label: string
}

export function createSettingsNetworkEntries(results: readonly RawWiFiScanResult[]): SettingsNetworkEntry[] {
  const strongestBySSID: Record<string, SettingsNetworkEntry> = {}

  for (const result of results) {
    const ssid = scanResultSSID(result)
    if (ssid.length === 0) continue

    const signal = scanResultSignal(result)
    const current = strongestBySSID[ssid]
    if (!current || isStrongerSignal(signal, current.signal)) {
      strongestBySSID[ssid] = {
        ssid,
        signal,
        label: formatNetworkLabel(ssid, signal),
      }
    }
  }

  return Object.values(strongestBySSID).sort(compareNetworkEntries)
}

function scanResultSSID(result: RawWiFiScanResult): string {
  const ssid = result.ssid ?? result.SSID ?? ''
  return String(ssid).trim()
}

function scanResultSignal(result: RawWiFiScanResult): number | undefined {
  const value = result.rssi ?? result.RSSI
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isStrongerSignal(next: number | undefined, current: number | undefined): boolean {
  if (next === undefined) return current === undefined
  if (current === undefined) return true
  return next > current
}

function compareNetworkEntries(left: SettingsNetworkEntry, right: SettingsNetworkEntry): number {
  if (left.signal !== undefined && right.signal !== undefined && left.signal !== right.signal) {
    return right.signal - left.signal
  }
  if (left.signal !== undefined && right.signal === undefined) return -1
  if (left.signal === undefined && right.signal !== undefined) return 1
  if (left.ssid < right.ssid) return -1
  if (left.ssid > right.ssid) return 1
  return 0
}

function formatNetworkLabel(ssid: string, signal: number | undefined): string {
  return signal === undefined ? ssid : `${ssid} (${signal} dBm)`
}
