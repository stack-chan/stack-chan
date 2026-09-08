import { StackchanError } from 'stackchan/errors'
import {
  isSettingKey,
  SETTING_KEYS,
  SETTINGS_SCHEMA,
  type SettingApplication,
  type SettingDomain,
  type SettingKey,
  type SettingsForDomain,
  type SettingValue,
  validateSetting,
} from 'stackchan/settings-schema'

export type SettingsLayer = Partial<Record<SettingDomain, Readonly<Record<string, unknown>>>>
export type SettingsStorage = {
  get(domain: string, name: string): unknown
  set(domain: string, name: string, value: unknown): void
  delete(domain: string, name: string): void
}
export type SettingsSource = 'default' | 'profile' | 'app' | 'stored'
export type SettingsIssue = { key: SettingKey; source: SettingsSource; code: 'INVALID' | 'READ_ONLY' }
export type SettingDescription = {
  prop: SettingKey
  value: string | number
  source: SettingsSource
  readOnly: boolean
  secret: boolean
  configured: boolean
  application: SettingApplication
}
type Options = {
  profile(): SettingsLayer
  app(): SettingsLayer
  storage: SettingsStorage
  onIssue?(issue: SettingsIssue): void
}

/** One resolver and write boundary. Descriptions never contain a secret value. */
export class SettingsService {
  readonly #options: Options
  #reported = new Set<string>()
  #faulted = false

  constructor(options: Options) {
    this.#options = options
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    return this.#resolve(key).value as SettingValue<K>
  }

  isReadOnly(key: SettingKey): boolean {
    return key === 'driver.type' && this.#options.profile().driver?.typeLocked === true
  }

  describe(key: SettingKey): SettingDescription {
    const resolved = this.#resolve(key)
    const definition = SETTINGS_SCHEMA[key]
    return {
      prop: key,
      value: definition.secret ? '' : (resolved.value ?? ''),
      source: resolved.source,
      readOnly: this.isReadOnly(key),
      secret: definition.secret,
      configured: resolved.value !== undefined && resolved.value !== '',
      application: definition.application,
    }
  }

  domain<D extends SettingDomain>(domain: D): SettingsForDomain<D> {
    const values: Record<string, unknown> = {}
    for (const key of SETTING_KEYS) {
      const [candidate, name] = key.split('.')
      if (candidate !== domain) continue
      const value = this.get(key)
      if (value !== undefined) values[name] = value
    }
    return values as SettingsForDomain<D>
  }

  set<K extends SettingKey>(key: K, value: SettingValue<K>): SettingDescription {
    return this.write({ [key]: value })[0]
  }

  /** Validate every field before storage. Roll back completed writes if storage fails. */
  write(values: Readonly<Record<string, unknown>>): SettingDescription[] {
    if (this.#faulted) throw new StackchanError('IO', 'Settings require restart after failed recovery')
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new StackchanError('INVALID_ARGUMENT', 'Settings must be an object')
    const entries = Object.entries(values)
    if (entries.length > SETTING_KEYS.length) throw new StackchanError('INVALID_ARGUMENT', 'Too many settings')
    const changes = entries.map(([key, input]) => {
      if (!isSettingKey(key)) throw new StackchanError('INVALID_ARGUMENT', 'Unknown setting')
      if (this.isReadOnly(key)) throw new StackchanError('CONFIG', `${key} is fixed by this hardware profile`)
      const result = validateSetting(key, input)
      if (result.valid === false) throw new StackchanError('INVALID_ARGUMENT', result.message)
      const [domain, name] = key.split('.')
      return { key, domain, name, value: result.value, previous: this.#read(domain, name) }
    })
    let attempted = 0
    try {
      for (const change of changes) {
        attempted += 1
        if (change.value === undefined) this.#options.storage.delete(change.domain, change.name)
        // Moddable Preference stores integer numbers; decimal settings use canonical text.
        else this.#options.storage.set(change.domain, change.name, String(change.value))
      }
    } catch {
      let recovered = true
      for (let index = attempted - 1; index >= 0; index -= 1) {
        const change = changes[index]
        try {
          if (change.previous == null) this.#options.storage.delete(change.domain, change.name)
          else this.#options.storage.set(change.domain, change.name, change.previous)
        } catch {
          recovered = false
        }
      }
      this.#faulted = !recovered
      throw new StackchanError(
        'IO',
        recovered
          ? 'Settings could not be saved'
          : 'Settings recovery failed; restart and review the saved configuration',
      )
    }
    return changes.map((change) => this.describe(change.key))
  }

  #resolve(key: SettingKey): { value: string | number | undefined; source: SettingsSource } {
    if (!isSettingKey(key)) throw new StackchanError('INVALID_ARGUMENT', 'Unknown setting')
    const definition = SETTINGS_SCHEMA[key]
    const [domain, name] = key.split('.') as [SettingDomain, string]
    const profile = this.#options.profile()
    const app = this.#options.app()
    const locked = key === 'driver.type' && profile.driver?.typeLocked === true
    let value: string | number | undefined = definition.defaultValue
    let source: SettingsSource = 'default'
    const layers: [SettingsSource, unknown][] = [
      ['profile', profile[domain]?.[name]],
      ['app', app[domain]?.[name]],
      ['stored', this.#read(domain, name)],
    ]
    for (const [candidate, input] of layers) {
      if (input == null) continue
      if ((locked && candidate !== 'profile') || (candidate === 'app' && !definition.appDefault)) {
        if (input !== value) this.#report({ key, source: candidate, code: 'READ_ONLY' })
        continue
      }
      const result = validateSetting(key, input)
      if (result.valid === false) {
        if (locked) throw new StackchanError('CONFIG', 'The hardware profile has an invalid fixed driver')
        this.#report({ key, source: candidate, code: 'INVALID' })
      } else if (result.value !== undefined) {
        value = result.value
        source = candidate
      }
    }
    if (locked && source !== 'profile')
      throw new StackchanError('CONFIG', 'The hardware profile must provide its fixed driver')
    return { value, source }
  }

  #read(domain: string, name: string): unknown {
    try {
      return this.#options.storage.get(domain, name)
    } catch {
      throw new StackchanError('IO', 'Settings could not be read')
    }
  }

  #report(issue: SettingsIssue): void {
    const id = `${issue.source}:${issue.key}:${issue.code}`
    if (this.#reported.has(id)) return
    this.#reported.add(id)
    try {
      this.#options.onIssue?.(issue)
    } catch {
      /* Diagnostics cannot own settings resolution. */
    }
  }
}
