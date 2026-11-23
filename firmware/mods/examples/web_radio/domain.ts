import { err, ok, type Result } from 'stackchan-result'

export const OFF_VALUE = 'off'
export const DEFAULT_OFF_LABEL = 'ラジオ停止'

export type Station = Readonly<{
  value: string
  label: string
  url: string
}>

export type RadioPlaybackState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'

export type RadioSelection = { readonly kind: 'off' } | { readonly kind: 'station'; readonly station: Station }

export type RadioError =
  | { readonly kind: 'network-unavailable' }
  | { readonly kind: 'network-offline'; readonly reason: string }
  | { readonly kind: 'radio-unsupported' }
  | { readonly kind: 'unknown-station'; readonly value: string }
  | { readonly kind: 'playback-failed'; readonly reason: string }

export function parseRadioSelection(value: string, stations: readonly Station[]): Result<RadioSelection, RadioError> {
  if (value === OFF_VALUE) {
    return ok({ kind: 'off' })
  }
  const station = stations.find((candidate) => candidate.value === value)
  if (!station) {
    return err({ kind: 'unknown-station', value })
  }
  return ok({ kind: 'station', station })
}

export function isConnectingState(state: RadioPlaybackState): boolean {
  return state === 'connecting' || state === 'buffering' || state === 'stalled' || state === 'retrying'
}

export function buildRadioDrawerOptions(stations: readonly Station[]): Array<{ value: string; label: string }> {
  return [{ value: OFF_VALUE, label: DEFAULT_OFF_LABEL }, ...stations.map(({ value, label }) => ({ value, label }))]
}

export function formatRadioError(error: RadioError): string {
  switch (error.kind) {
    case 'network-unavailable':
      return 'Network is not available on this target.'
    case 'network-offline':
      return `Network unavailable: ${error.reason}`
    case 'radio-unsupported':
      return 'WebRadio is not supported on this target.'
    case 'unknown-station':
      return `Unknown station: ${error.value}`
    case 'playback-failed':
      return `Radio error: ${error.reason}`
    default: {
      const _exhaustive: never = error
      return String(_exhaustive)
    }
  }
}
