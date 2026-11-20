type PreferenceDomainValues = Record<string, unknown>
type PreferenceStore = Record<string, PreferenceDomainValues>

const values: PreferenceStore = Object.create(null)

function assertSupportedPreferenceValue(value: unknown): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('float unsupported')
    return
  }
  if (typeof value === 'boolean' || typeof value === 'string' || value instanceof ArrayBuffer) return
  throw new Error('unsupported type')
}

const Preference = {
  get(domain: string, key: string): unknown {
    return values[domain]?.[key]
  },

  set(domain: string, key: string, value: unknown): void {
    assertSupportedPreferenceValue(value)
    let domainValues = values[domain]
    if (!domainValues) {
      domainValues = Object.create(null)
      values[domain] = domainValues
    }
    domainValues[key] = value
  },

  delete(domain: string, key: string): void {
    const domainValues = values[domain]
    if (!domainValues || domainValues[key] === undefined) return

    delete domainValues[key]
    if (Object.keys(domainValues).length === 0) {
      delete values[domain]
    }
  },

  keys(domain: string): string[] {
    const domainValues = values[domain]
    return domainValues ? Object.keys(domainValues) : []
  },
}

export default Preference
