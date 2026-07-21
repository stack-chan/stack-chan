import { localize } from 'localization'
import type { NetworkReadyResult } from './boot-services.js'

export type BootWiFiRecoveryChoice = 'retry' | 'offline'

export type BootWiFiFailureKind = 'scan-exhausted' | 'connection-failed'
type OfflineNetworkReadyResult = Extract<NetworkReadyResult, { status: 'skipped' }>

export function shouldRetryBootWiFiAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts
}

export function classifyBootWiFiFailure(reason: string): BootWiFiFailureKind {
  const normalized = reason.toLowerCase()
  if (normalized.includes('not found') || normalized.includes('scan exhausted')) {
    return 'scan-exhausted'
  }
  return 'connection-failed'
}

export function bootWiFiFailureMessage(reason: string): string {
  if (classifyBootWiFiFailure(reason) === 'scan-exhausted') {
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
