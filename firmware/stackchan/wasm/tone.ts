export default class Tone {
  constructor(_options?: unknown) {
    void _options
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    await globalThis.Host?.AudioOut?.tone?.({ hz, duration, volume })
  }

  close() {
    globalThis.Host?.AudioOut?.close?.()
  }
}
