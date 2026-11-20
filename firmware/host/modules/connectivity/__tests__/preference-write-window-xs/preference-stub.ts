// The connectivity manifest preloads modules that import Preference. Allocate
// mutable storage at runtime so XS does not retain a read-only link-time Map.
let values: Map<string, unknown> | undefined

const Preference = {
  get(domain: string, name: string): unknown {
    return values?.get(`${domain}.${name}`)
  },
  set(domain: string, name: string, value: unknown): void {
    values ??= new Map<string, unknown>()
    values.set(`${domain}.${name}`, value)
  },
}

export default Preference
