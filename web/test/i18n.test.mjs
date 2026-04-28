import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, messages, normalizeLocale, resolveLocale, t } from '../i18n.mjs'

describe('web i18n', () => {
  it('keeps all locale dictionaries aligned with the English keys', () => {
    const baseKeys = Object.keys(messages.en).sort()

    for (const locale of SUPPORTED_LOCALES) {
      assert.deepEqual(Object.keys(messages[locale]).sort(), baseKeys, `${locale} keys must match en`)
    }
  })

  it('falls back to English and then the key for missing translations', () => {
    assert.equal(t('ja', 'common.submit'), '保存')
    assert.equal(t('unknown', 'common.submit'), 'Submit')
    assert.equal(t('ja', 'missing.key'), 'missing.key')
  })

  it('normalizes supported browser locales', () => {
    assert.equal(DEFAULT_LOCALE, 'en')
    assert.equal(normalizeLocale('ja-JP'), 'ja')
    assert.equal(normalizeLocale('en-US'), 'en')
    assert.equal(normalizeLocale('zh-CN'), 'zh-Hans')
    assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-Hans')
    assert.equal(normalizeLocale('zh-TW'), 'zh-Hans')
    assert.equal(normalizeLocale('fr-FR'), undefined)
  })

  it('resolves locale from query, storage, navigator, then fallback', () => {
    assert.equal(
      resolveLocale({
        search: '?lang=ja',
        storedLocale: 'en',
        navigatorLanguages: ['zh-CN'],
      }),
      'ja'
    )

    assert.equal(
      resolveLocale({
        search: '',
        storedLocale: 'ja',
        navigatorLanguages: ['zh-CN'],
      }),
      'ja'
    )

    assert.equal(
      resolveLocale({
        search: '',
        storedLocale: undefined,
        navigatorLanguages: ['zh-CN'],
      }),
      'zh-Hans'
    )

    assert.equal(resolveLocale({ search: '', storedLocale: undefined, navigatorLanguages: ['fr-FR'] }), 'en')
  })

  it('applies text and attribute translations to marked elements', async () => {
    const { applyI18n } = await import('../i18n.mjs')
    const textElement = { dataset: { i18n: 'common.submit' }, textContent: '' }
    const placeholderElement = { dataset: { i18nPlaceholder: 'tts.host.placeholder' }, placeholder: '' }
    const titleElement = { dataset: { i18nTitle: 'preference.disconnect.title' }, title: '' }
    const ariaElement = {
      dataset: { i18nAriaLabel: 'flash.target.ariaLabel' },
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value
      },
    }
    const selectorElement = { value: '' }
    const root = {
      title: '',
      documentElement: { lang: '' },
      querySelectorAll(selector) {
        return (
          {
            '[data-i18n]': [textElement],
            '[data-i18n-placeholder]': [placeholderElement],
            '[data-i18n-title]': [titleElement],
            '[data-i18n-aria-label]': [ariaElement],
            '[data-i18n-document-title]': [{ dataset: { i18nDocumentTitle: 'preference.documentTitle' } }],
            '[data-i18n-locale-selector]': [selectorElement],
          }[selector] ?? []
        )
      },
    }

    assert.equal(applyI18n('ja', root), 'ja')
    assert.equal(root.documentElement.lang, 'ja')
    assert.equal(root.title, 'ｽﾀｯｸﾁｬﾝ設定')
    assert.equal(textElement.textContent, '保存')
    assert.equal(placeholderElement.placeholder, 'my-tts-host.local')
    assert.equal(titleElement.title, '切断')
    assert.equal(ariaElement.attributes['aria-label'], '対象デバイス')
    assert.equal(selectorElement.value, 'ja')
  })
})
