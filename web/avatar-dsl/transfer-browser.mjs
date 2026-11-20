/** Compile an AVBC face MOD in a disposable worker; terminate runaway builds. */
export async function buildTransferArchiveInWorker(bytecode, { onLog = () => {}, timeoutMs = 30000, signal } = {}) {
  const worker = new Worker(new URL('./transfer-worker.mjs', import.meta.url), {
    type: 'module',
    name: 'avatar-dsl-mod-build',
  })
  const bytes = Uint8Array.from(bytecode instanceof ArrayBuffer ? new Uint8Array(bytecode) : bytecode).buffer
  let timer
  let abort
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new DOMException('Build cancelled', 'AbortError'))
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(
        () => reject(new Error('MOD build exceeded its time limit')),
        Math.min(60000, Math.max(1000, timeoutMs))
      )
      worker.addEventListener('message', ({ data }) => {
        if (data.type === 'log') onLog(data.message)
        else if (data.type === 'success') resolve(new Uint8Array(data.archive))
        else if (data.type === 'error') reject(new Error(data.error))
      })
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'MOD build worker failed')))
      worker.postMessage({ type: 'build', bytecode: bytes }, [bytes])
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    worker.terminate()
  }
}
