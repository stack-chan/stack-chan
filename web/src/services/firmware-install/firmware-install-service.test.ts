import { afterEach, describe, expect, it, vi } from 'vitest'

import { firmwareInstallInternals, installFirmware } from '@/services/firmware-install/firmware-install-service'

const board = { id: 'cores3', label: 'CoreS3', manifestUrl: 'https://example.test/manifest.json' }
const manifest = {
  name: 'Stack-chan',
  version: '1.2.3',
  builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: './firmware.bin', offset: 65536 }] }],
}

function setup({ approved = true, chip = 'ESP32-S3', imageStatus = 200, empty = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) =>
      String(input).endsWith('manifest.json')
        ? new Response(JSON.stringify(manifest), { status: 200 })
        : new Response(empty ? new Uint8Array() : Uint8Array.from([1, 2, 3]), { status: imageStatus })
    )
  )
  const write = vi.fn(async (_files, progress: (index: number, written: number, total: number) => void) => {
    progress(0, 3, 3)
  })
  const adapter = {
    inspect: vi.fn(async () => chip),
    write,
    resetToRunApp: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  }
  const callbacks = { onLog: vi.fn(), onStage: vi.fn(), onProgress: vi.fn(), onConfirm: vi.fn(async () => approved) }
  return { adapter, callbacks, factory: vi.fn(async () => adapter) }
}

describe('firmware install service', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('validates manifests before exposing write targets', () => {
    expect(() => firmwareInstallInternals.validateManifest({ name: 'broken' })).toThrow(
      'manifestに必要なファームウェア情報がありません'
    )
    for (const parts of [[], [{ path: 'bad.bin', offset: -1 }]]) {
      expect(() =>
        firmwareInstallInternals.validateManifest({ ...manifest, builds: [{ chipFamily: 'ESP32-S3', parts }] })
      ).toThrow('manifestの書き込み対象が不正です')
    }
    expect(firmwareInstallInternals.canonicalChipFamily('ESP32-S3 revision 0.2')).toBe('ESP32-S3')
  })

  it.each([undefined, false, true])(
    'confirms and forwards eraseAll=%s, then resets and disconnects',
    async (eraseAll) => {
      const { adapter, callbacks, factory } = setup()
      const result = await installFirmware(
        {} as never,
        board,
        callbacks,
        eraseAll === undefined ? undefined : { eraseAll },
        factory
      )
      expect(callbacks.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ eraseAll: eraseAll ?? false }))
      expect(adapter.write).toHaveBeenCalledExactlyOnceWith(
        [{ address: 65536, bytes: Uint8Array.from([1, 2, 3]) }],
        expect.any(Function),
        { eraseAll: eraseAll ?? false }
      )
      expect(callbacks.onProgress).toHaveBeenLastCalledWith(1)
      expect(adapter.resetToRunApp).toHaveBeenCalledOnce()
      expect(adapter.disconnect).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ bytesWritten: 3, eraseAll: eraseAll ?? false })
    }
  )

  it.each([false, true])('never writes or erases after cancellation (eraseAll=%s)', async (eraseAll) => {
    const { adapter, callbacks, factory } = setup({ approved: false })
    await expect(installFirmware({} as never, board, callbacks, { eraseAll }, factory)).resolves.toBeNull()
    expect(adapter.write).not.toHaveBeenCalled()
    expect(adapter.resetToRunApp).toHaveBeenCalledOnce()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    { chip: 'ESP32', message: '書き込めません' },
    { imageStatus: 404, message: '取得できませんでした' },
    { empty: true, message: 'イメージが空' },
  ])('does not erase on preflight/download failure: %s', async ({ message, ...options }) => {
    const { adapter, callbacks, factory } = setup(options)
    await expect(installFirmware({} as never, board, callbacks, { eraseAll: true }, factory)).rejects.toThrow(message)
    expect(adapter.write).not.toHaveBeenCalled()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })

  it('propagates erase/write failure without reporting success or rebooting', async () => {
    const { adapter, callbacks, factory } = setup()
    adapter.write.mockRejectedValueOnce(new Error('erase failed'))
    await expect(installFirmware({} as never, board, callbacks, { eraseAll: true }, factory)).rejects.toThrow(
      'erase failed'
    )
    expect(callbacks.onProgress).not.toHaveBeenCalledWith(1)
    expect(adapter.resetToRunApp).not.toHaveBeenCalled()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })
})
