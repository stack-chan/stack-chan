const values = new Map<string, unknown>()

function preferenceKey(domain: string, name: string): string {
  return `${domain}.${name}`
}

const Preference = {
  get(domain: string, name: string): unknown {
    return values.get(preferenceKey(domain, name))
  },
  set(domain: string, name: string, value: unknown): void {
    values.set(preferenceKey(domain, name), value)
  },
}

export function resetPreference(nextValues: Record<string, unknown> = {}): void {
  values.clear()
  for (const [name, value] of Object.entries(nextValues)) {
    values.set(name, value)
  }
}

export default Preference
