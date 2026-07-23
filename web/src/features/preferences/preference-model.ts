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
}

export const isPreferenceKey = (value: string): value is PreferenceKey =>
  (PREFERENCE_KEYS as readonly string[]).includes(value)
