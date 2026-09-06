const resources = new Map<string, ArrayBuffer>()

export default class Resource extends ArrayBuffer {
  static exists(path: string): boolean {
    return resources.has(path)
  }
  constructor(path: string) {
    const bytes = resources.get(path)
    if (!bytes) throw new Error(`Missing resource: ${path}`)
    super(bytes.byteLength)
    new Uint8Array(this).set(new Uint8Array(bytes))
  }
}

export function resetResources(values: Record<string, ArrayBuffer> = {}): void {
  resources.clear()
  for (const [name, bytes] of Object.entries(values)) resources.set(name, bytes)
}
