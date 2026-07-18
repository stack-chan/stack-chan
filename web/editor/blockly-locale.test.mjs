import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blocklyMessageUrl, loadBlocklyMessages } from './blockly-locale.mjs'

test('Blockly locale loader uses official message bundles for Japanese and Simplified Chinese', () => {
  assert.equal(blocklyMessageUrl('en'), null)
  assert.match(blocklyMessageUrl('ja'), /blockly@11\.2\.2\/msg\/ja\.js$/)
  assert.match(blocklyMessageUrl('zh-CN'), /blockly@11\.2\.2\/msg\/zh-hans\.js$/)
})

test('Blockly locale loader keeps the built-in English messages', async () => {
  await assert.doesNotReject(loadBlocklyMessages('en', null))
})
