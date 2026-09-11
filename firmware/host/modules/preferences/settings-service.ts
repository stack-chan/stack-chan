import { StackchanError } from 'stackchan/errors'
import {
  isSettingKey,
  SETTING_KEYS,
  SETTINGS_MESSAGE_MAX_BYTES,
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
// The undo record is separate from managed setting domains and is removed on commit.
export const SETTINGS_JOURNAL = Object.freeze({ domain: 'settings', key: 'pending' })
type JournalValue = string | number | boolean | null | number[]
type JournalEntry = [SettingKey, JournalValue]

function journalValue(value: unknown): JournalValue {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value)))
    return value
  if (value instanceof ArrayBuffer && value.byteLength <= SETTINGS_MESSAGE_MAX_BYTES)
    return Array.from(new Uint8Array(value))
  throw new StackchanError('IO', 'Saved settings have an unsupported storage type')
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
    this.#recover()
    return this.#resolve(key).value as SettingValue<K>
  }

  isReadOnly(key: SettingKey): boolean {
    return key === 'driver.type' && this.#options.profile().driver?.typeLocked === true
  }

  describe(key: SettingKey): SettingDescription {
    this.#recover()
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

  /** Persist undo data before touching fields; clearing it commits the entire batch. */
  write(values: Readonly<Record<string, unknown>>): SettingDescription[] {
    this.#recover()
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
    if (changes.length === 0) return []
    const journal = JSON.stringify({
      version: 1,
      entries: changes.map(({ key, previous }) => [key, journalValue(previous)]),
    })
    if (journal.length > SETTINGS_MESSAGE_MAX_BYTES * 6)
      throw new StackchanError('IO', 'Settings recovery record is too large')
    try {
      this.#save(SETTINGS_JOURNAL.domain, SETTINGS_JOURNAL.key, journal)
      for (const change of changes) {
        // Moddable Preference stores integer numbers; decimal settings use canonical text.
        this.#save(change.domain, change.name, change.value === undefined ? undefined : String(change.value))
      }
      this.#save(SETTINGS_JOURNAL.domain, SETTINGS_JOURNAL.key, undefined)
    } catch {
      try {
        this.#recover()
      } catch {
        this.#faulted = true
      }
      throw new StackchanError(
        'IO',
        this.#faulted
          ? 'Settings recovery failed; restart and review the saved configuration'
          : 'Settings could not be saved',
      )
    }
    return changes.map((change) => this.describe(change.key))
  }

  #recover(): void {
    if (this.#faulted) throw new StackchanError('IO', 'Settings require restart after failed recovery')
    const journal = this.#read(SETTINGS_JOURNAL.domain, SETTINGS_JOURNAL.key)
    if (journal === undefined) return
    try {
      if (typeof journal !== 'string' || journal.length > SETTINGS_MESSAGE_MAX_BYTES * 6) throw new Error()
      const record = JSON.parse(journal)
      if (record?.version !== 1 || !Array.isArray(record.entries) || record.entries.length > SETTING_KEYS.length)
        throw new Error()
      const seen = new Set<string>()
      // Validate the complete record before any recovery write. Never expose its values in errors.
      const entries: JournalEntry[] = record.entries.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2 || !isSettingKey(entry[0]) || seen.has(entry[0]))
          throw new Error()
        const [key, value] = entry
        seen.add(key)
        if (Array.isArray(value)) {
          if (
            value.length > SETTINGS_MESSAGE_MAX_BYTES ||
            value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
          )
            throw new Error()
        } else journalValue(value)
        return [key, value]
      })
      for (const [key, previous] of entries) {
        const [domain, name] = key.split('.')
        this.#save(domain, name, Array.isArray(previous) ? Uint8Array.from(previous).buffer : (previous ?? undefined))
      }
      this.#save(SETTINGS_JOURNAL.domain, SETTINGS_JOURNAL.key, undefined)
    } catch {
      this.#faulted = true
      throw new StackchanError('IO', 'Settings recovery failed; restart and review the saved configuration')
    }
  }

  #save(domain: string, name: string, value: unknown): void {
    if (value === undefined) this.#options.storage.delete(domain, name)
    else this.#options.storage.set(domain, name, value)
    const saved = this.#read(domain, name)
    if (value instanceof ArrayBuffer && saved instanceof ArrayBuffer) {
      const savedBytes = new Uint8Array(saved)
      if (
        value.byteLength === saved.byteLength &&
        new Uint8Array(value).every((byte, index) => byte === savedBytes[index])
      )
        return
    } else if (saved === value) return
    throw new StackchanError('IO', 'Settings storage did not confirm the write')
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
