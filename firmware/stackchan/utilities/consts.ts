export const DOMAIN = {
  wifi: 'wifi',
  driver: 'driver',
  renderer: 'renderer',
  tts: 'tts',
  ai: 'ai',
} as const

export const PREF_KEYS: readonly [keyof typeof DOMAIN, string, StringConstructor | NumberConstructor][] = Object.freeze(
  [
    [DOMAIN.wifi, 'ssid', String],
    [DOMAIN.wifi, 'password', String],
    [DOMAIN.renderer, 'type', String],
    [DOMAIN.driver, 'type', String],
    [DOMAIN.driver, 'baudrate', Number],
    [DOMAIN.driver, 'offsetPan', Number],
    [DOMAIN.driver, 'offsetTilt', Number],
    [DOMAIN.tts, 'type', String],
    [DOMAIN.tts, 'host', String],
    [DOMAIN.tts, 'port', Number],
    [DOMAIN.tts, 'token', String],
    [DOMAIN.ai, 'token', String],
    [DOMAIN.ai, 'context', String],
  ],
  true
)

export const DEFAULT_FONT = 'OpenSans-Regular-24.bf4'
