type SerialPortLike = {
  setSignals: (signals: { dataTerminalReady: boolean; requestToSend: boolean }) => Promise<void>
}

type LoaderTerminal = {
  clean: () => void
  write: (value: string) => void
  writeLine: (value: string) => void
}

type EsptoolModule = {
  Transport: new (
    port: SerialPortLike,
    tracing: boolean
  ) => {
    disconnect: () => Promise<void>
  }
  ESPLoader: new (options: {
    transport: unknown
    baudrate: number
    romBaudrate: number
    terminal: LoaderTerminal
    debugLogging: boolean
  }) => {
    IS_STUB: boolean
    main: () => Promise<string>
    writeFlash: (options: {
      fileArray: { data: Uint8Array; address: number }[]
      flashSize: string
      flashMode: string
      flashFreq: string
      eraseAll: boolean
      compress: boolean
      reportProgress: (fileIndex: number, written: number, total: number) => void
    }) => Promise<void>
  }
}

export type FlashWriteOptions = {
  eraseAll?: boolean
}

export type EsptoolAdapter = {
  inspect: () => Promise<string>
  write: (
    files: { bytes: Uint8Array; address: number }[],
    onProgress: (fileIndex: number, written: number, total: number) => void,
    options?: FlashWriteOptions
  ) => Promise<void>
  resetToRunApp: () => Promise<void>
  disconnect: () => Promise<void>
}

type EsptoolModuleLoader = () => Promise<EsptoolModule>

const loadEsptoolModule: EsptoolModuleLoader = async () => (await import('esptool-js')) as unknown as EsptoolModule

const createLoaderTerminal = (onLog: (message: string) => void) => {
  let pending = ''

  const emit = (value: string) => {
    const normalized = value.replaceAll('\r', '')
    for (const line of normalized.split('\n')) {
      if (line) onLog(`[esptool] ${line}`)
    }
  }

  const flush = () => {
    if (!pending) return
    emit(pending)
    pending = ''
  }

  return {
    terminal: {
      clean() {
        pending = ''
      },
      write(value: string) {
        pending += value
        const lines = pending.replaceAll('\r', '').split('\n')
        pending = lines.pop() ?? ''
        emit(lines.join('\n'))
      },
      writeLine(value: string) {
        flush()
        emit(value)
      },
    },
    flush,
  }
}

export async function createEsptoolAdapter(
  port: SerialPortLike,
  onLog: (message: string) => void,
  baudrate = 115200,
  moduleLoader = loadEsptoolModule
): Promise<EsptoolAdapter> {
  const module = await moduleLoader()
  const transport = new module.Transport(port, false)
  const terminal = createLoaderTerminal(onLog)
  const loader = new module.ESPLoader({
    transport,
    baudrate,
    romBaudrate: 115200,
    terminal: terminal.terminal,
    debugLogging: true,
  })

  return {
    async inspect() {
      try {
        return await loader.main()
      } finally {
        terminal.flush()
      }
    },
    async write(files, reportProgress, { eraseAll = false } = {}) {
      // esptool-js silently skips eraseAll without a stub. Never report a full erase in that case.
      if (eraseAll && loader.IS_STUB !== true) {
        throw new Error('フラッシュ全体の消去に必要なスタブが起動していません。書き込みを中止しました。')
      }
      await loader.writeFlash({
        fileArray: files.map(({ bytes, address }) => ({
          data: bytes,
          address,
        })),
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll,
        compress: true,
        reportProgress,
      })
    },
    async resetToRunApp() {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true })
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      await port.setSignals({ dataTerminalReady: false, requestToSend: false })
    },
    disconnect: () => transport.disconnect(),
  }
}
