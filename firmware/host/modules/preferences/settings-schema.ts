/** Portable settings contract shared by the firmware and configuration UI. */
export const DOMAIN = Object.freeze({
  wifi: 'wifi',
  driver: 'driver',
  ui: 'ui',
  tts: 'tts',
  ai: 'ai',
  led: 'led',
  mcp: 'mcp',
  time: 'time',
} as const)
export type SettingApplication = 'live' | 'reconnect' | 'restart'
export const SETTINGS_PROTOCOL_VERSION = 2
export const SETTINGS_MESSAGE_MAX_BYTES = 32_768
export type SettingsSaveReceipt = {
  confirmed: boolean
  applications?: readonly SettingApplication[]
  applyFailed?: boolean
}
type Definition<T extends string | number> = Readonly<{
  kind: 'string' | 'number'
  defaultValue: T | undefined
  optional: boolean
  secret: boolean
  application: SettingApplication
  appDefault: boolean
  choices?: readonly string[]
  minimum?: number
  maximum?: number
  integer?: boolean
  maxBytes?: number
}>

function text(defaultValue: string | undefined, maxBytes: number, secret = false): Definition<string> {
  return Object.freeze({
    kind: 'string',
    defaultValue,
    maxBytes,
    secret,
    optional: defaultValue === undefined,
    application: 'restart',
    appDefault: true,
  })
}
function number(
  defaultValue: number | undefined,
  minimum: number,
  maximum: number,
  integer = false,
  application: SettingApplication = 'restart',
): Definition<number> {
  return Object.freeze({
    kind: 'number',
    defaultValue,
    minimum,
    maximum,
    integer,
    optional: defaultValue === undefined,
    secret: false,
    application,
    appDefault: true,
  })
}
function choice<T extends string>(
  defaultValue: T,
  choices: readonly T[],
  application: SettingApplication = 'restart',
): Definition<T> {
  return Object.freeze({
    kind: 'string',
    defaultValue,
    choices: Object.freeze([...choices]),
    optional: false,
    secret: false,
    application,
    appDefault: true,
  })
}

export const TIMEZONE_PRESETS = Object.freeze(
  (
    [
      { id: 'honolulu', labelKey: 'timezone.city.honolulu', offsetMinutes: -600 },
      { id: 'los-angeles', labelKey: 'timezone.city.losAngeles', offsetMinutes: -480 },
      { id: 'denver', labelKey: 'timezone.city.denver', offsetMinutes: -420 },
      { id: 'chicago', labelKey: 'timezone.city.chicago', offsetMinutes: -360 },
      { id: 'new-york', labelKey: 'timezone.city.newYork', offsetMinutes: -300 },
      { id: 'sao-paulo', labelKey: 'timezone.city.saoPaulo', offsetMinutes: -180 },
      { id: 'london', labelKey: 'timezone.city.london', offsetMinutes: 0 },
      { id: 'paris', labelKey: 'timezone.city.paris', offsetMinutes: 60 },
      { id: 'cairo', labelKey: 'timezone.city.cairo', offsetMinutes: 120 },
      { id: 'moscow', labelKey: 'timezone.city.moscow', offsetMinutes: 180 },
      { id: 'dubai', labelKey: 'timezone.city.dubai', offsetMinutes: 240 },
      { id: 'delhi', labelKey: 'timezone.city.delhi', offsetMinutes: 330 },
      { id: 'bangkok', labelKey: 'timezone.city.bangkok', offsetMinutes: 420 },
      { id: 'beijing', labelKey: 'timezone.city.beijing', offsetMinutes: 480 },
      { id: 'tokyo', labelKey: 'timezone.city.tokyo', offsetMinutes: 540 },
      { id: 'sydney', labelKey: 'timezone.city.sydney', offsetMinutes: 600 },
      { id: 'auckland', labelKey: 'timezone.city.auckland', offsetMinutes: 720 },
    ] as const
  ).map((preset) => Object.freeze(preset)),
)
export type TimezoneId = (typeof TIMEZONE_PRESETS)[number]['id']
export type TimezonePreset = (typeof TIMEZONE_PRESETS)[number]
export const DEFAULT_TIMEZONE_ID: TimezoneId = 'tokyo'

export const SETTINGS_SCHEMA = Object.freeze({
  'wifi.ssid': Object.freeze({ ...text('', 32), application: 'reconnect' as const, appDefault: false }),
  'wifi.password': Object.freeze({ ...text('', 64, true), application: 'reconnect' as const, appDefault: false }),
  'ui.type': choice('simple', ['simple', 'dog', 'image', 'small-face']),
  'ui.language': choice('ja', ['ja', 'en', 'zh-CN'], 'live'),
  'driver.type': choice('scservo', ['scservo', 'm5stackchan', 'dynamixel', 'pwm', 'rs30x', 'none']),
  'driver.baudrate': number(undefined, 9_600, 4_000_000, true),
  'driver.offsetPan': number(0, -180, 180),
  'driver.offsetTilt': number(0, -180, 180),
  'tts.type': choice('local', [
    'local',
    'remote',
    'voicevox',
    'voicevox-web',
    'elevenlabs',
    'openai',
    'stackchan-voice',
  ]),
  'tts.host': text(undefined, 253),
  'tts.port': number(undefined, 1, 65_535, true),
  'tts.token': text('', 2_048, true),
  'tts.volume': number(0.5, 0, 1, false, 'live'),
  'tts.voice': text(undefined, 256),
  'tts.speed': number(undefined, 0.01, 1_000),
  'ai.token': text('', 2_048, true),
  'ai.context': text(undefined, 2_048),
  'mcp.token': text('', 2_048, true),
  'time.timezone': choice(
    DEFAULT_TIMEZONE_ID,
    TIMEZONE_PRESETS.map((preset) => preset.id),
    'live',
  ),
})

export type SettingKey = keyof typeof SETTINGS_SCHEMA
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS_SCHEMA)[K] extends Definition<infer T> ? T | undefined : never
export type SettingDomain = keyof typeof DOMAIN
export type SettingsForDomain<D extends SettingDomain> = {
  [K in SettingKey as K extends `${D}.${infer Name}` ? Name : never]?: SettingValue<K>
}
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA) as SettingKey[])
/** Legacy tuple view is derived from the same definitions used for validation. */
export const PREF_KEYS: readonly (readonly [SettingDomain, string, StringConstructor | NumberConstructor])[] =
  Object.freeze(
    SETTING_KEYS.map((key) => {
      const [domain, name] = key.split('.')
      return Object.freeze([
        domain as SettingDomain,
        name,
        SETTINGS_SCHEMA[key].kind === 'number' ? Number : String,
      ] as const)
    }),
  )

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTINGS_SCHEMA, value)
}

function utf8Length(value: string): number {
  let length = 0
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if (point >= 0xd800 && point <= 0xdfff) return Number.POSITIVE_INFINITY
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
  }
  return length
}

export type SettingValidation = { valid: true; value: string | number | undefined } | { valid: false; message: string }

/** Numeric strings support existing NVS/BLE values; empty optional fields reset to defaults. */
export function validateSetting(key: SettingKey, input: unknown): SettingValidation {
  const definition: Definition<string | number> = SETTINGS_SCHEMA[key]
  if (definition.optional && (input === undefined || input === '')) return { valid: true, value: undefined }
  if (definition.kind === 'number') {
    const value = typeof input === 'string' && input.trim() !== '' ? Number(input) : input
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < (definition.minimum ?? Number.NEGATIVE_INFINITY) ||
      value > (definition.maximum ?? Number.POSITIVE_INFINITY) ||
      (definition.integer && !Number.isInteger(value))
    )
      return { valid: false, message: `${key} must be a number in its supported range` }
    return { valid: true, value }
  }
  // Numeric voice IDs were accepted by older provider configuration files.
  const value = key === 'tts.voice' && typeof input === 'number' && Number.isFinite(input) ? String(input) : input
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    (definition.maxBytes !== undefined && utf8Length(value) > definition.maxBytes)
  )
    return { valid: false, message: `${key} must be text within its supported length` }
  if (definition.choices && !definition.choices.includes(value))
    return { valid: false, message: `${key} has an unsupported selection` }
  return { valid: true, value }
}
