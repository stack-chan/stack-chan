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
  ESPLoader: new (options: { transport: unknown; baudrate: number; terminal: LoaderTerminal }) => {
    main: () => Promise<string>
    writeFlash: (options: {
      fileArray: { data: string; address: number }[]
      flashSize: string
      flashMode: string
      flashFreq: string
      eraseAll: boolean
      compress: boolean
      reportProgress: (fileIndex: number, written: number, total: number) => void
    }) => Promise<void>
  }
}

export type EsptoolAdapter = {
  inspect: () => Promise<string>
  write: (
    files: { bytes: Uint8Array; address: number }[],
    onProgress: (fileIndex: number, written: number, total: number) => void
  ) => Promise<void>
  resetToRunApp: () => Promise<void>
  disconnect: () => Promise<void>
}

const bytesToBinaryString = (bytes: Uint8Array) => {
  let result = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunkSize)))
  }
  return result
}

export async function createEsptoolAdapter(
  port: SerialPortLike,
  onLog: (message: string) => void,
  baudrate = 115200
): Promise<EsptoolAdapter> {
  const module = (await import('../../../editor/vendor/esptool-js-0.5.7.bundle.mjs')) as EsptoolModule
  const transport = new module.Transport(port, true)
  const loader = new module.ESPLoader({
    transport,
    baudrate,
    terminal: {
      clean() {},
      write() {},
      writeLine(line) {
        onLog(`[esptool] ${line}`)
      },
    },
  })

  return {
    inspect: () => loader.main(),
    write: (files, reportProgress) =>
      loader.writeFlash({
        fileArray: files.map(({ bytes, address }) => ({
          data: bytesToBinaryString(bytes),
          address,
        })),
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress,
      }),
    async resetToRunApp() {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true })
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      await port.setSignals({ dataTerminalReady: false, requestToSend: false })
    },
    disconnect: () => transport.disconnect(),
  }
}
