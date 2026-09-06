let moduleValues: Record<string, unknown> = {}

const Modules = {
  get archive(): string[] {
    return []
  },
  has(specifier: string): boolean {
    return Object.hasOwn(moduleValues, specifier)
  },
  importNow(specifier: string): unknown {
    return moduleValues[specifier]
  },
}

export function resetModules(values: Record<string, unknown> = {}): void {
  moduleValues = values
}

export default Modules
