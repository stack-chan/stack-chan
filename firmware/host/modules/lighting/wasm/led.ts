export default class Led {
  get available(): boolean {
    return false
  }
  // biome-ignore lint/complexity/noUselessConstructor: wasm stub keeps constructor options compatible with native LED drivers.
  constructor(_options?: unknown) {}
  write(..._args: unknown[]) {}
  on(..._args: unknown[]) {}
  off(..._args: unknown[]) {}
  blink(..._args: unknown[]) {}
  rainbow(..._args: unknown[]) {}
  close() {}
}
