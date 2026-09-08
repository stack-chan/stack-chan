import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { SettingApplication, SettingKey, SettingValue } from 'stackchan/settings-schema'

export type { SettingKey, SettingValue } from 'stackchan/settings-schema'
export type SettingDescription = Readonly<{
  prop: SettingKey
  value: string | number
  source: 'default' | 'profile' | 'app' | 'stored'
  readOnly: boolean
  secret: boolean
  configured: boolean
  application: SettingApplication
}>
/** The same validated settings and precedence used by the host and configuration UI. */
export interface AppSettings {
  get<K extends SettingKey>(key: K): SettingValue<K>
  describe(key: SettingKey): SettingDescription
  set<K extends SettingKey>(key: K, value: SettingValue<K>): SettingDescription
}
export function settings(app: AppContext): AppSettings {
  const value = (app as AppContext & { settings?: AppSettings }).settings
  if (!value) throw new StackchanError('UNSUPPORTED', 'Settings are unavailable')
  return value
}
