import { afterEach, describe, expect, it, vi } from 'vitest'

import { firmwareInstallInternals, installFirmware } from '@/services/firmware-install/firmware-install-service'

describe('firmware install service', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('validates manifests before exposing write targets', () => {
    expect(() => firmwareInstallInternals.validateManifest({ name: 'broken' })).toThrow(
      'manifestに必要なファームウェア情報がありません'
    )
    expect(firmwareInstallInternals.canonicalChipFamily('ESP32-S3 revision 0.2')).toBe('ESP32-S3')
  })

  it('owns inspection, confirmation, progress, reset, and disconnect', async () => {
    const manifest = {
      name: 'Stack-chan',
      version: '1.2.3',
      builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: './firmware.bin', offset: 4096 }] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        return url.endsWith('manifest.json')
          ? new Response(JSON.stringify(manifest), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(Uint8Array.from([1, 2, 3]), { status: 200 })
      })
    )
    const write = vi.fn(async (_files, progress: (index: number, written: number, total: number) => void) => {
      progress(0, 3, 3)
    })
    const resetToRunApp = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    const adapterFactory = vi.fn(async () => ({
      inspect: async () => 'ESP32-S3',
      write,
      resetToRunApp,
      disconnect,
    }))
    const onConfirm = vi.fn(async () => true)
    const onProgress = vi.fn()
    const result = await installFirmware(
      {} as never,
      { id: 'cores3', label: 'CoreS3', manifestUrl: 'https://example.test/manifest.json' },
      {
        onLog: () => {},
        onStage: () => {},
        onProgress,
        onConfirm,
      },
      adapterFactory as never
    )
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenLastCalledWith(1)
    expect(resetToRunApp).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(result?.bytesWritten).toBe(3)
  })
})
