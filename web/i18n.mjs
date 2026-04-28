export const DEFAULT_LOCALE = 'en'
export const LOCALE_STORAGE_KEY = 'stackchan.ui.locale'
export const SUPPORTED_LOCALES = ['ja', 'en', 'zh-Hans']

export const localeLabels = {
  ja: '日本語',
  en: 'English',
  'zh-Hans': '简体中文',
}

export const messages = {
  en: {
    'common.language': 'Language',
    'common.submit': 'Submit',
    'common.type': 'Type',
    'common.token': 'Token',
    'common.disconnect': 'Disconnect',
    'preference.documentTitle': 'Stack-chan preferences',
    'preference.connect': 'Connect Stack-chan with BLE [・＿・]',
    'preference.title': 'Stack-chan preferences',
    'preference.saved': 'Preferences saved [・＿・]',
    'preference.disconnect.title': 'Disconnect',
    'section.wifi': 'WiFi',
    'section.face': 'Face',
    'section.servo': 'Servo',
    'section.tts': 'TTS',
    'section.ai': 'AI',
    'wifi.ssid': 'SSID',
    'wifi.password': 'Password',
    'driver.offsetPan': 'Offset Pan',
    'driver.offsetTilt': 'Offset Tilt',
    'tts.host': 'Host',
    'tts.host.placeholder': 'my-tts-host.local',
    'tts.port': 'Port',
    'tts.port.placeholder': '50021',
    'tts.voice': 'Voice',
    'tts.voice.placeholder': 'ally',
    'tts.volume': 'Volume',
    'ai.context': 'System Role',
    'ai.context.placeholder': 'You are Stack-chan(スタックチャン), the palm sized super kawaii companion robot.',
    'flash.documentTitle': 'Flash firmware',
    'flash.target.ariaLabel': 'Target device',
    'flash.action': 'Flash Stack-chan firmware [・＿・]',
    'flash.unsupported': "Ah snap, your browser doesn't work!",
    'flash.notAllowed': 'Ah snap, you are not allowed to use this on HTTP!',
  },
  ja: {
    'common.language': '言語',
    'common.submit': '保存',
    'common.type': '種類',
    'common.token': 'トークン',
    'common.disconnect': '切断',
    'preference.documentTitle': 'ｽﾀｯｸﾁｬﾝ設定',
    'preference.connect': 'BLEでｽﾀｯｸﾁｬﾝに接続 [・＿・]',
    'preference.title': 'ｽﾀｯｸﾁｬﾝ設定',
    'preference.saved': '設定を保存しました [・＿・]',
    'preference.disconnect.title': '切断',
    'section.wifi': 'WiFi',
    'section.face': '顔',
    'section.servo': 'サーボ',
    'section.tts': 'TTS',
    'section.ai': 'AI',
    'wifi.ssid': 'SSID',
    'wifi.password': 'パスワード',
    'driver.offsetPan': 'パンのオフセット',
    'driver.offsetTilt': 'チルトのオフセット',
    'tts.host': 'ホスト',
    'tts.host.placeholder': 'my-tts-host.local',
    'tts.port': 'ポート',
    'tts.port.placeholder': '50021',
    'tts.voice': '声',
    'tts.voice.placeholder': 'ally',
    'tts.volume': '音量',
    'ai.context': 'システムロール',
    'ai.context.placeholder': 'あなたは手のひらサイズのスーパーカワイイロボット「ｽﾀｯｸﾁｬﾝ」です。',
    'flash.documentTitle': 'ファームウェア書き込み',
    'flash.target.ariaLabel': '対象デバイス',
    'flash.action': 'ｽﾀｯｸﾁｬﾝのファームウェアを書き込む [・＿・]',
    'flash.unsupported': 'このブラウザでは使えません。',
    'flash.notAllowed': 'HTTP ではこの機能を使えません。',
  },
  'zh-Hans': {
    'common.language': '语言',
    'common.submit': '保存',
    'common.type': '类型',
    'common.token': '令牌',
    'common.disconnect': '断开连接',
    'preference.documentTitle': 'Stack-chan 设置',
    'preference.connect': '通过 BLE 连接 Stack-chan [・＿・]',
    'preference.title': 'Stack-chan 设置',
    'preference.saved': '设置已保存 [・＿・]',
    'preference.disconnect.title': '断开连接',
    'section.wifi': 'WiFi',
    'section.face': '表情',
    'section.servo': '舵机',
    'section.tts': 'TTS',
    'section.ai': 'AI',
    'wifi.ssid': 'SSID',
    'wifi.password': '密码',
    'driver.offsetPan': '水平偏移',
    'driver.offsetTilt': '垂直偏移',
    'tts.host': '主机',
    'tts.host.placeholder': 'my-tts-host.local',
    'tts.port': '端口',
    'tts.port.placeholder': '50021',
    'tts.voice': '声音',
    'tts.voice.placeholder': 'ally',
    'tts.volume': '音量',
    'ai.context': '系统角色',
    'ai.context.placeholder': '你是 Stack-chan（スタックチャン），一个手掌大小的超可爱陪伴机器人。',
    'flash.documentTitle': '刷写固件',
    'flash.target.ariaLabel': '目标设备',
    'flash.action': '刷写 Stack-chan 固件 [・＿・]',
    'flash.unsupported': '抱歉，你的浏览器不支持此功能！',
    'flash.notAllowed': '抱歉，HTTP 页面不允许使用此功能！',
  },
}

export function normalizeLocale(locale) {
  if (typeof locale !== 'string' || locale.length === 0) {
    return undefined
  }

  if (SUPPORTED_LOCALES.includes(locale)) {
    return locale
  }

  const lowerLocale = locale.toLowerCase()
  if (lowerLocale.startsWith('ja')) {
    return 'ja'
  }
  if (lowerLocale.startsWith('en')) {
    return 'en'
  }
  if (lowerLocale.startsWith('zh')) {
    return 'zh-Hans'
  }

  return undefined
}

export function resolveLocale({ search = '', storedLocale, navigatorLanguages = [] } = {}) {
  const queryLocale = new URLSearchParams(search).get('lang')
  const candidates = [queryLocale, storedLocale, ...navigatorLanguages]

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate)
    if (locale != null) {
      return locale
    }
  }

  return DEFAULT_LOCALE
}

export function t(locale, key) {
  const normalizedLocale = normalizeLocale(locale) ?? DEFAULT_LOCALE
  return messages[normalizedLocale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key
}

export function applyI18n(locale, root = document) {
  const normalizedLocale = normalizeLocale(locale) ?? DEFAULT_LOCALE
  const documentElement = root.documentElement ?? root.ownerDocument?.documentElement

  if (documentElement != null) {
    documentElement.lang = normalizedLocale
  }

  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(normalizedLocale, element.dataset.i18n)
  }

  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(normalizedLocale, element.dataset.i18nPlaceholder)
  }

  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    element.title = t(normalizedLocale, element.dataset.i18nTitle)
  }

  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(normalizedLocale, element.dataset.i18nAriaLabel))
  }

  for (const element of root.querySelectorAll('[data-i18n-document-title]')) {
    root.title = t(normalizedLocale, element.dataset.i18nDocumentTitle)
  }

  for (const selector of root.querySelectorAll('[data-i18n-locale-selector]')) {
    selector.value = normalizedLocale
  }

  return normalizedLocale
}

export function initI18n({
  root = document,
  storage = globalThis.localStorage,
  location = globalThis.location,
  navigator = globalThis.navigator,
} = {}) {
  let currentLocale = resolveLocale({
    search: location?.search ?? '',
    storedLocale: storage?.getItem?.(LOCALE_STORAGE_KEY),
    navigatorLanguages: navigator?.languages ?? [navigator?.language],
  })

  const setLocale = (locale) => {
    currentLocale = applyI18n(locale, root)
    storage?.setItem?.(LOCALE_STORAGE_KEY, currentLocale)
    return currentLocale
  }

  for (const selector of root.querySelectorAll('[data-i18n-locale-selector]')) {
    selector.addEventListener('change', (event) => {
      setLocale(event.target.value)
    })
  }

  setLocale(currentLocale)

  return {
    getLocale: () => currentLocale,
    setLocale,
  }
}
