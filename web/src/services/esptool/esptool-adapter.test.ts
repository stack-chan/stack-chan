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
        eraseAll: false,
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

// Run the pinned library's writeFlash/eraseFlash/flashDeflBegin implementations.
// Only bootloader negotiation and the command transport are simulated; this is not a device test.
describe('esptool-js erase command contract', () => {
  it.each([
    ['ESP32', 0x1000, false],
    ['ESP32', 0x1000, true],
    ['ESP32-S3', 0, false],
    ['ESP32-S3', 0, true],
  ] as const)('%s at %i, eraseAll=%s', async (chip, bootAddress, eraseAll) => {
    const { ESPLoader: RealLoader } = await import('esptool-js')
    const commands: { opcode: number; data?: Uint8Array }[] = []
    class Transport {
      getInfo() {
        return 'test transport'
      }
      async disconnect() {}
    }
    class ESPLoader extends RealLoader {
      async main() {
        this.IS_STUB = true
        this.chip = { CHIP_NAME: chip } as typeof this.chip
        return chip
      }
      async checkCommand(_description?: string, opcode = 0, data?: Uint8Array) {
        commands.push({ opcode, data })
        return 0
      }
    }
    const adapter = await createEsptoolAdapter(
      { setSignals: async () => {} },
      () => {},
      115200,
      async () => ({ Transport, ESPLoader }) as never
    )
    await adapter.inspect()
    const files = [
      { bytes: Uint8Array.from([1, 2, 3]), address: bootAddress },
      { bytes: new Uint8Array(0xc00).fill(2), address: 0x8000 },
      { bytes: new Uint8Array(0x1004).fill(3), address: 0x10000 },
    ]
    await adapter.write(files, () => {}, { eraseAll })
    // A chip erase must precede all region commands and occurs only by explicit request.
    expect(commands.filter(({ opcode }) => opcode === 0xd0)).toHaveLength(eraseAll ? 1 : 0)
    if (eraseAll) expect(commands[0].opcode).toBe(0xd0)
    const regions = commands
      .filter(({ opcode }) => opcode === 0x10)
      .map(({ data }) => {
        const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
        return { size: view.getUint32(0, true), address: view.getUint32(12, true) }
      })
    expect(regions).toEqual(files.map(({ bytes, address }) => ({ size: Math.ceil(bytes.length / 4) * 4, address })))
  })

  it('refuses full erase when the stub is absent instead of silently skipping it', async () => {
    const writeFlash = vi.fn(async () => {})
    class Transport {
      async disconnect() {}
    }
    class ESPLoader {
      IS_STUB = false
      async main() {
        return 'ESP32'
      }
      writeFlash = writeFlash
    }
    const adapter = await createEsptoolAdapter(
      { setSignals: async () => {} },
      () => {},
      115200,
      async () => ({ Transport, ESPLoader }) as never
    )
    await adapter.inspect()
    await expect(
      adapter.write([{ bytes: new Uint8Array([1]), address: 0 }], () => {}, { eraseAll: true })
    ).rejects.toThrow('スタブ')
    expect(writeFlash).not.toHaveBeenCalled()
  })

  it('does not write any region if the chip erase command fails', async () => {
    const { ESPLoader: RealLoader } = await import('esptool-js')
    const opcodes: number[] = []
    class Transport {
      getInfo() {
        return 'test'
      }
      async disconnect() {}
    }
    class ESPLoader extends RealLoader {
      async main() {
        this.IS_STUB = true
        return 'ESP32-S3'
      }
      async checkCommand(_description?: string, opcode = 0): Promise<number> {
        opcodes.push(opcode)
        throw new Error('chip erase failed')
      }
    }
    const adapter = await createEsptoolAdapter(
      { setSignals: async () => {} },
      () => {},
      115200,
      async () => ({ Transport, ESPLoader }) as never
    )
    await adapter.inspect()
    await expect(
      adapter.write([{ bytes: new Uint8Array([1]), address: 0x10000 }], () => {}, { eraseAll: true })
    ).rejects.toThrow('chip erase failed')
    expect(opcodes).toEqual([0xd0])
  })
})
