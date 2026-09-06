import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(hostRoot, 'localization', resolve(hostRoot, 'modules/testing/fakes/localization.js'))

const { bootWiFiFailureMessage } = await import('../boot-network-recovery.js')

test('boot Wi-Fi errors explain a missing access point or another connection failure', () => {
  for (const reason of ['Access point "home-ap" not found', 'Scan exhausted'])
    assert.equal(bootWiFiFailureMessage(reason), '保存済みWi-Fiが見つかりません')
  for (const reason of ['authentication failed', 'connection timeout'])
    assert.equal(bootWiFiFailureMessage(reason), 'Wi-Fi接続に失敗しました')
})
