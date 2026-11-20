export class TTS {
  // biome-ignore lint/complexity/noUselessConstructor: wasm stub keeps constructor options compatible with native TTS engines.
  constructor(_options?: unknown) {}
  stream(_text: string, _volume?: number, callback?: (error?: unknown) => void): void {
    callback?.()
  }
}
