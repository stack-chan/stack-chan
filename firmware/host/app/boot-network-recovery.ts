import { localize } from 'localization'

export function bootWiFiFailureMessage(reason: string): string {
  const normalized = reason.toLowerCase()
  return localize(
    normalized.includes('not found') || normalized.includes('scan exhausted') ? 'boot.wifiNotFound' : 'boot.wifiFailed',
  )
}
