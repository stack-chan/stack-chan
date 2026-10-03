export type MockI2COperation = {
  kind: 'read' | 'write'
  data?: readonly number[]
  error?: unknown
}

export type MockI2CScenario = {
  operations?: readonly MockI2COperation[]
  constructorError?: unknown
  closeError?: unknown
}

let nextScenario: MockI2CScenario | undefined
const instances: MockI2C[] = []

function bytesEqual(actual: Uint8Array, expected: readonly number[]): boolean {
  if (actual.byteLength !== expected.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false
  }
  return true
}

export default class MockI2C {
  readonly options: Record<string, unknown>
  closeCount = 0
  closed = false
  #closeError: unknown
  #operations: MockI2COperation[]

  constructor(options: Record<string, unknown>) {
    const scenario = nextScenario
    nextScenario = undefined
    if (scenario === undefined) throw new Error('MockI2C scenario was not prepared')
    if (scenario.constructorError !== undefined) throw scenario.constructorError

    this.options = { ...options }
    this.#closeError = scenario.closeError
    this.#operations = [...(scenario.operations ?? [])]
    instances.push(this)
  }

  get pendingOperationCount(): number {
    return this.#operations.length
  }

  close(): void {
    this.closeCount += 1
    this.closed = true
    if (this.#closeError !== undefined) throw this.#closeError
  }

  read(buffer: Uint8Array): void {
    const operation = this.#take('read')
    if (operation.data !== undefined) {
      if (buffer.byteLength !== operation.data.length) {
        throw new Error(`MockI2C read length mismatch: expected ${operation.data.length}, got ${buffer.byteLength}`)
      }
      buffer.set(operation.data)
    }
    if (operation.error !== undefined) throw operation.error
  }

  write(buffer: Uint8Array): void {
    const operation = this.#take('write')
    if (operation.data !== undefined && !bytesEqual(buffer, operation.data)) {
      throw new Error(
        `MockI2C write mismatch: expected ${operation.data.join(',')}, got ${Array.from(buffer).join(',')}`,
      )
    }
    if (operation.error !== undefined) throw operation.error
  }

  #take(kind: MockI2COperation['kind']): MockI2COperation {
    if (this.closed) throw new Error('MockI2C is closed')
    const operation = this.#operations.shift()
    if (operation === undefined) throw new Error(`Unexpected MockI2C ${kind}`)
    if (operation.kind !== kind) throw new Error(`MockI2C expected ${operation.kind}, got ${kind}`)
    return operation
  }
}

export function prepareMockI2C(scenario: MockI2CScenario): void {
  nextScenario = scenario
}

export function resetMockI2C(): void {
  nextScenario = undefined
  instances.length = 0
}

export function getMockI2CInstances(): readonly MockI2C[] {
  return instances
}

export function assertMockI2CConsumed(instance: MockI2C): void {
  if (instance.pendingOperationCount !== 0) {
    throw new Error(`MockI2C has ${instance.pendingOperationCount} pending operation(s)`)
  }
}
