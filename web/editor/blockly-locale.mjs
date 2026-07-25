import * as English from 'blockly/msg/en'
import * as Japanese from 'blockly/msg/ja'
import * as SimplifiedChinese from 'blockly/msg/zh-hans'

const MESSAGE_CATALOGS = Object.freeze({
  ja: Japanese,
  en: English,
  'zh-CN': SimplifiedChinese,
})

export function blocklyMessagesFor(locale) {
  return MESSAGE_CATALOGS[locale] ?? MESSAGE_CATALOGS.ja
}

export function loadBlocklyMessages(locale, Blockly = globalThis.Blockly) {
  Blockly?.setLocale?.(blocklyMessagesFor(locale))
  return Promise.resolve()
}
