import type { SupportedLocale } from '../../../modules/testing/fakes/localization.js'
import type { TimezoneId } from '../../../modules/preferences/timezone-model.js'
import type { SettingsNetworkEntry } from '../../../modules/ui/views/settings/settings-network-list.js'
import type { SettingsStatus } from '../../../modules/ui/views/settings/settings-status-model.js'

export { SettingsStatusValue } from '../../../modules/ui/views/settings/settings-status-model.js'

export const SettingsViewId = {
  MENU: 0,
  WIFI: 1,
  PASSWORD: 2,
  LANGUAGE: 3,
  OFFLINE: 4,
  TIMEZONE: 5,
  VOLUME: 6,
} as const
export type SettingsViewId = (typeof SettingsViewId)[keyof typeof SettingsViewId]
export type SettingsApplication = { empty(): void; add(content: unknown): void }

export type SettingsViewContext = {
  state: {
    status: SettingsStatus
    networks: readonly SettingsNetworkEntry[]
    selectedSSID: string
    language: SupportedLocale
    timezone: TimezoneId
    volume: number
  }
  actions: {
    exit(): void
    boot(): void
    bootOffline(): void
    navigate(view: SettingsViewId): void
    scanWifi(): void
    cancelWifiScan(): void
    selectWifiNetwork(network: SettingsNetworkEntry): void
    submitWifiPassword(password: string): void
    selectLanguage(locale: SupportedLocale): void
    saveTimezone(timezone: TimezoneId): void
    saveVolume(volume: number): void
  }
}

export type SettingsViewInstance = {
  content: unknown
  update(): void
  dispose(): void
  updates: number
  disposals: number
}

export let lastContext: SettingsViewContext | undefined
export const views: SettingsViewInstance[] = []

export const settingsViews = Object.fromEntries(
  Object.values(SettingsViewId).map((id) => [
    id,
    {
      create(context: SettingsViewContext): SettingsViewInstance {
        lastContext = context
        const view = {
          content: { id },
          updates: 0,
          disposals: 0,
          update() {
            view.updates += 1
          },
          dispose() {
            view.disposals += 1
          },
        }
        views.push(view)
        return view
      },
    },
  ]),
)

export function resetSettingsViews(): void {
  lastContext = undefined
  views.length = 0
}
