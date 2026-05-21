export class TTS {
  // biome-ignore lint/complexity/noUselessConstructor: wasm stub keeps constructor options compatible with native TTS engines.
  constructor(_options?: unknown) {}
  async stream(_text: string, _volume?: number): Promise<void> {}
}
