export default class Microphone {
  constructor(_options?: unknown) {
    void _options
  }

  async record(durationMilliSec = 3000): Promise<ArrayBuffer> {
    return (await globalThis.Host?.AudioIn?.record?.(durationMilliSec)) ?? new ArrayBuffer(0)
  }

  close() {
    globalThis.Host?.AudioIn?.close?.()
  }
}
