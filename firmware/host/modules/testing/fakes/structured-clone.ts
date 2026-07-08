export default function structuredClone<T>(value: T): T {
  return globalThis.structuredClone(value)
}
