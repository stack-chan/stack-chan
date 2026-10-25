import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { HostInstallForm } from '@/features/firmware-install/host-install-form'
import { translate } from '@/lib/i18n/translate'
import { createEsptoolAdapter } from '@/services/esptool/esptool-adapter'

vi.mock('@/services/esptool/esptool-adapter', () => ({ createEsptoolAdapter: vi.fn() }))

const warning =
  'フラッシュ全体を消去すると、本体に保存した設定とインストール済みのMODを含むすべてのデータが失われます。この操作は取り消せません。'
const normal =
  '通常はフラッシュ全体を消去せず、ファームウェアを書き込みます。設定やMODは、保存領域が上書きされず、パーティション配置と新しいファームウェアに互換性がある場合に保持されます。'

function setup(locale: 'ja' | 'en' | 'zh-CN') {
  localStorage.setItem('stackchan.locale', locale)
  vi.stubGlobal('isSecureContext', true)
  const requestPort = vi.fn(async () => ({}))
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) =>
      String(input).endsWith('.json')
        ? new Response(
            JSON.stringify({
              name: 'Stack-chan',
              version: '2.0.1',
              builds: [{ chipFamily: 'ESP32', parts: [{ path: 'host.bin', offset: 65536 }] }],
            })
          )
        : new Response(Uint8Array.from([1, 2, 3]))
    )
  )
  const adapter = {
    inspect: vi.fn(async () => 'ESP32'),
    write: vi.fn(async () => {}),
    resetToRunApp: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  }
  vi.mocked(createEsptoolAdapter).mockResolvedValue(adapter)
  render(
    <I18nProvider>
      <HostInstallForm />
    </I18nProvider>
  )
  return { adapter, requestPort, t: (key: string) => translate(locale, key), user: userEvent.setup() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serial')
})

describe.each(['ja', 'en', 'zh-CN'] as const)('HostInstallForm in %s', (locale) => {
  it.each([false, true])('confirms the selected mode and passes eraseAll=%s to the writer', async (eraseAll) => {
    const { adapter, user, t } = setup(locale)
    const checkbox = screen.getByRole('checkbox', { name: t('フラッシュ全体を消去してから書き込む') })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText(t(normal))).toBeVisible()
    expect(screen.getByText(t(warning))).toBeVisible()
    if (locale !== 'ja') {
      // Missing translations must not silently fall back to Japanese in a destructive flow.
      expect(t(normal)).not.toBe(normal)
      expect(t(warning)).not.toBe(warning)
    }
    if (eraseAll) await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: t('USBに接続して書き込む') }))
    const dialog = await screen.findByRole('alertdialog')
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByText(t(eraseAll ? warning : normal))).toBeVisible()
    expect(adapter.write).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t(eraseAll ? '全消去して書き込む' : '書き込む') }))
    await waitFor(() =>
      expect(adapter.write).toHaveBeenCalledExactlyOnceWith(expect.any(Array), expect.any(Function), { eraseAll })
    )
    expect(adapter.resetToRunApp).toHaveBeenCalledOnce()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })

  it('cancels a destructive confirmation without calling the writer', async () => {
    const { adapter, user, t } = setup(locale)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: t('USBに接続して書き込む') }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: t('キャンセル') }))
    await waitFor(() => expect(adapter.disconnect).toHaveBeenCalledOnce())
    expect(adapter.write).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-disabled', 'true')
  })
})
