export function createProjectAutosave<T>(save: (state: T) => Promise<void>, onError: (error: unknown) => void) {
  let latest: { state: T } | undefined
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (running) return running
    running = (async () => {
      while (latest) {
        const saving = latest
        try {
          await save(saving.state)
        } catch (error) {
          onError(error)
          return
        }
        if (latest === saving) latest = undefined
      }
    })().finally(() => {
      running = undefined
    })
    return running
  }

  return {
    submit(state: T) {
      latest = { state }
      // 入力イベントから保存の直列化処理を分離し、待機中の編集は最後の状態にまとめる
      if (!running && timer === undefined)
        timer = setTimeout(() => {
          void flush()
        }, 200)
    },
    flush,
    get pending() {
      return latest !== undefined
    },
  }
}
