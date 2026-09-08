let archiveValues: string[] = []
let moduleValues: Record<string, unknown> = {}

const Modules = {
  get archive(): string[] {
    return archiveValues
  },
  has(specifier: string): boolean {
    return Object.hasOwn(moduleValues, specifier)
  },
  importNow(specifier: string): unknown {
    return moduleValues[specifier]
  },
}

export function resetModules(values: Record<string, unknown> = {}, archive: string[] = []): void {
  moduleValues = values
  archiveValues = archive
}

export default Modules
