export const PREFERENCE_KEYS = [
  'wifi.ssid',
  'wifi.password',
  'driver.type',
  'driver.offsetPan',
  'driver.offsetTilt',
  'ui.type',
  'ui.language',
  'tts.type',
  'tts.host',
  'tts.port',
  'tts.token',
  'tts.voice',
  'tts.volume',
  'ai.token',
  'ai.context',
  'mcp.token',
] as const

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]
export type PreferenceValues = Record<PreferenceKey, string>

export const DEFAULT_PREFERENCES: PreferenceValues = {
  'wifi.ssid': '',
  'wifi.password': '',
  'driver.type': 'm5stackchan',
  'driver.offsetPan': '0',
  'driver.offsetTilt': '0',
  'ui.type': 'simple',
  'ui.language': 'ja',
  'tts.type': 'voicevox',
  'tts.host': '',
  'tts.port': '',
  'tts.token': '',
  'tts.voice': '',
  'tts.volume': '1',
  'ai.token': '',
  'ai.context': '',
  'mcp.token': '',
}

export const isPreferenceKey = (value: string): value is PreferenceKey =>
  (PREFERENCE_KEYS as readonly string[]).includes(value)

type PreferenceField = {
  label: string
  secret?: boolean
  options?: { value: string; label: string; translate?: boolean }[]
  input?: { type: string; min?: number; max?: number; step?: string }
}
export const PREFERENCE_FIELDS: Record<PreferenceKey, PreferenceField> = {
  'wifi.ssid': { label: 'SSID' },
  'wifi.password': { label: 'パスワード', secret: true, input: { type: 'password' } },
  'driver.type': {
    label: 'ドライバー',
    options: [
      { value: 'm5stackchan', label: 'M5StackChan Servo（CoreS3専用・推奨）' },
      { value: 'scservo', label: 'SCServo（汎用・外部配線向け）' },
      { value: 'dynamixel', label: 'Dynamixel（Protocol 2）' },
      { value: 'rs30x', label: 'RS30X' },
      { value: 'pwm', label: 'PWM（SG-90）' },
      { value: 'none', label: 'なし' },
    ],
  },
  'driver.offsetPan': { label: 'パン オフセット', input: { type: 'number', step: 'any' } },
  'driver.offsetTilt': { label: 'チルト オフセット', input: { type: 'number', step: 'any' } },
  'ui.type': {
    label: '顔の種類',
    options: [
      { value: 'simple', label: 'シンプル' },
      { value: 'dog', label: 'いぬ' },
    ],
  },
  'ui.language': {
    label: '本体の表示言語',
    options: [
      { value: 'ja', label: '日本語', translate: false },
      { value: 'en', label: 'English', translate: false },
      { value: 'zh-CN', label: '简体中文', translate: false },
    ],
  },
  'tts.type': {
    label: 'サービス',
    options: [
      { value: 'voicevox', label: 'VOICEVOX', translate: false },
      { value: 'elevenlabs', label: 'ElevenLabs', translate: false },
      { value: 'google-tts', label: 'Google TTS', translate: false },
      { value: 'openai', label: 'OpenAI', translate: false },
      { value: 'local', label: 'ローカル' },
    ],
  },
  'tts.host': { label: 'ホスト' },
  'tts.port': { label: 'ポート', input: { type: 'number', min: 1, max: 65535, step: '1' } },
  'tts.token': { label: 'トークン', secret: true, input: { type: 'password' } },
  'tts.voice': { label: '音声' },
  'tts.volume': { label: '音量（0–1）', input: { type: 'number', min: 0, max: 1, step: '0.1' } },
  'ai.token': { label: 'トークン', secret: true, input: { type: 'password' } },
  'ai.context': { label: 'システムロール' },
  'mcp.token': { label: 'Bearerトークン', secret: true, input: { type: 'password' } },
}

export function validPreferenceValue(key: PreferenceKey, value: string) {
  const field = PREFERENCE_FIELDS[key]
  if (field.options) return field.options.some((option) => option.value === value)
  if (field.input?.type !== 'number') return true
  if (!value.trim()) return key === 'tts.port'
  const number = Number(value)
  return (
    Number.isFinite(number) &&
    (field.input.min === undefined || number >= field.input.min) &&
    (field.input.max === undefined || number <= field.input.max) &&
    (key !== 'tts.port' || Number.isInteger(number))
  )
}
