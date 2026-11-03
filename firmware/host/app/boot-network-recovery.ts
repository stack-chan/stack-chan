import { localize } from 'localization'
import type { NetworkReadyResult } from './boot-services.js'

export type BootWiFiRecoveryChoice = 'retry' | 'offline'

export type BootWiFiFailureKind = 'scan-exhausted' | 'connection-failed' | 'time-sync-failed'
type OfflineNetworkReadyResult = Extract<NetworkReadyResult, { status: 'skipped' }>

export function shouldRetryBootWiFiAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts
}

export function classifyBootWiFiFailure(reason: string): BootWiFiFailureKind {
  const normalized = reason.toLowerCase()
  if (normalized.includes('failed to get time')) {
    return 'time-sync-failed'
  }
  if (normalized.includes('not found') || normalized.includes('scan exhausted')) {
    return 'scan-exhausted'
  }
  return 'connection-failed'
}

export function bootWiFiFailureMessage(reason: string, sntpHost?: string): string {
  const kind = classifyBootWiFiFailure(reason)
  if (kind === 'time-sync-failed') {
    const message = localize('boot.timeSyncFailed')
    return sntpHost ? `${message}\n${sntpHost}` : message
  }
  if (kind === 'scan-exhausted') {
    return localize('boot.wifiNotFound')
  }
  return localize('boot.wifiFailed')
}

export function networkReadyResultForRecoveryChoice(
  choice: BootWiFiRecoveryChoice,
  reason: string,
): OfflineNetworkReadyResult | undefined {
  if (choice === 'retry') return undefined
  return {
    status: 'skipped',
    reason: `offline start selected: ${reason}`,
  }
}
