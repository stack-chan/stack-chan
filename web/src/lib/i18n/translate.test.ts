import { describe, expect, it } from 'vitest'

import { translate } from '@/lib/i18n/translate'

describe('simulator startup failure translation', () => {
  it.each([
    ['ja', 'ファームウェアの起動に失敗しました'],
    ['en', 'Firmware startup failed'],
    ['zh-CN', '固件启动失败'],
  ] as const)('uses the selected %s locale for a startup failure', (locale, expected) => {
    expect(translate(locale, 'ファームウェアの起動に失敗しました')).toBe(expected)
  })
})
