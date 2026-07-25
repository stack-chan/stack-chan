import { describe, expect, it, vi } from 'vitest'

import { createEsptoolAdapter } from '@/services/esptool/esptool-adapter'

describe('esptool adapter', () => {
  it('uses the current Uint8Array flashing API and preserves the USB reset sequence', async () => {
    const onLog = vi.fn()
    const setSignals = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    const writeFlash = vi.fn(async () => {})
    const bytes = Uint8Array.from([1, 2, 3])
    let loaderOptions:
      | {
          baudrate: number
          romBaudrate: number
          debugLogging: boolean
          terminal: {
            write: (value: string) => void
            writeLine: (value: string) => void
          }
        }
      | undefined
    let tracing: boolean | undefined

    class Transport {
      constructor(_port: unknown, enabled: boolean) {
        tracing = enabled
      }

      disconnect = disconnect
    }

    class ESPLoader {
      constructor(options: NonNullable<typeof loaderOptions>) {
        loaderOptions = options
      }

      async main() {
        loaderOptions?.terminal.write('Connecting...')
        loaderOptions?.terminal.write('.')
        return 'ESP32-S3'
      }

      writeFlash = writeFlash
    }

    const adapter = await createEsptoolAdapter(
      { setSignals },
      onLog,
      115200,
      async () => ({ Transport, ESPLoader }) as never
    )

    await expect(adapter.inspect()).resolves.toBe('ESP32-S3')
    await adapter.write([{ bytes, address: 0x1000 }], () => {})
    await adapter.resetToRunApp()
    await adapter.disconnect()

    expect(tracing).toBe(false)
    expect(loaderOptions).toMatchObject({
      baudrate: 115200,
      romBaudrate: 115200,
      debugLogging: true,
    })
    expect(onLog).toHaveBeenCalledWith('[esptool] Connecting....')
    expect(writeFlash).toHaveBeenCalledWith(
      expect.objectContaining({
        fileArray: [{ data: bytes, address: 0x1000 }],
      })
    )
    expect(setSignals).toHaveBeenNthCalledWith(1, {
      dataTerminalReady: false,
      requestToSend: true,
    })
    expect(setSignals).toHaveBeenNthCalledWith(2, {
      dataTerminalReady: false,
      requestToSend: false,
    })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('flushes partial connection diagnostics when inspection fails', async () => {
    const onLog = vi.fn()

    class Transport {
      async disconnect() {}
    }

    class ESPLoader {
      private readonly terminal: LoaderTerminal

      constructor({ terminal }: { terminal: LoaderTerminal }) {
        this.terminal = terminal
      }

      async main(): Promise<string> {
        this.terminal.write('Connecting...')
        this.terminal.write('.....')
        throw new Error('Failed to connect with the device')
      }

      async writeFlash() {}
    }

    type LoaderTerminal = {
      write: (value: string) => void
    }

    const adapter = await createEsptoolAdapter(
      { setSignals: async () => {} },
      onLog,
      115200,
      async () => ({ Transport, ESPLoader }) as never
    )

    await expect(adapter.inspect()).rejects.toThrow('Failed to connect with the device')
    expect(onLog).toHaveBeenCalledWith('[esptool] Connecting........')
  })
})
