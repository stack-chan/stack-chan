import TextEncoder from 'text/encoder'
import { makeXsArchive, modDefinition } from 'xsa-fixture'

globalThis.TextEncoder = TextEncoder
export const state = { future: false }

export default Object.freeze({
  list: () => ['demo.xsa'],
  read: (_name: string, _maximumBytes: number) =>
    makeXsArchive({ metadata: state.future ? { ...modDefinition, hostApiVersion: 999 } : modDefinition }).buffer,
  xsVersionRange: () => [17, 8, 17, 8] as const,
})
