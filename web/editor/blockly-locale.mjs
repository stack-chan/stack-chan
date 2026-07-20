const BLOCKLY_VERSION = '11.2.2'
// Blockly locale bundles expose messages through script side effects rather
// than ESM exports, so load the reviewed upstream files with pinned integrity.
const MESSAGE_SCRIPTS = Object.freeze({
  ja: {
    name: 'ja',
    integrity: 'sha384-vwDwBIqpZ3trnzftlXPz5I2KLW59rnUE3qmcgJ/PRqFMMtz0GRpLJcwHfc0X7s2r',
  },
  'zh-CN': {
    name: 'zh-hans',
    integrity: 'sha384-mGFejCoyTYOsEjmfdk5WRD/rxnYwSlBTwrHrwfu36nAC24+WjiWYhrPcqPH+1vM8',
  },
})

function blocklyMessageUrl(locale) {
  const descriptor = MESSAGE_SCRIPTS[locale]
  return descriptor ? `https://unpkg.com/blockly@${BLOCKLY_VERSION}/msg/${descriptor.name}.js` : null
}

export function loadBlocklyMessages(locale, documentRef = globalThis.document) {
  const descriptor = MESSAGE_SCRIPTS[locale]
  if (!descriptor || !documentRef) return Promise.resolve()
  const existing = documentRef.querySelector(`script[data-blockly-locale="${locale}"]`)
  if (existing?.dataset.loaded === 'true') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = existing ?? documentRef.createElement('script')
    script.dataset.blocklyLocale = locale
    script.src = blocklyMessageUrl(locale)
    script.integrity = descriptor.integrity
    script.crossOrigin = 'anonymous'
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true'
        resolve()
      },
      { once: true }
    )
    script.addEventListener('error', () => reject(new Error(`Unable to load Blockly messages for ${locale}`)), {
      once: true,
    })
    if (!existing) documentRef.head.append(script)
  })
}
