import type { Container as PiuContainer } from 'piu/MC'

export const MINI_APP_BAR_HEIGHT = 44

export type MiniAppContext = Readonly<{
  width: number
  height: number
  close(): void
}>

export type MiniAppInstance = Readonly<{
  content: PiuContainer
  dispose?(): void
}>

export type MiniAppDefinition = Readonly<{
  id: string
  title: string
  icon?: 'play'
  create(context: MiniAppContext): PiuContainer | MiniAppInstance
}>

export type RegisteredMiniApp = Readonly<Pick<MiniAppDefinition, 'id' | 'title' | 'icon'>>

export type MiniAppRegistryCapability = Readonly<{
  register(definition: MiniAppDefinition): () => void
}>

type RegistryListener = () => void

const MINI_APP_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_MINI_APP_ID_LENGTH = 64
const MAX_MINI_APP_TITLE_LENGTH = 32

function validateDefinition(definition: MiniAppDefinition): MiniAppDefinition {
  if (!definition || typeof definition !== 'object') throw new TypeError('mini app definition must be an object')
  if (
    typeof definition.id !== 'string' ||
    definition.id.length === 0 ||
    definition.id.length > MAX_MINI_APP_ID_LENGTH ||
    !MINI_APP_ID_PATTERN.test(definition.id)
  ) {
    throw new TypeError('mini app id must be 1-64 lowercase ASCII characters separated by ., _, or -')
  }
  const title = typeof definition.title === 'string' ? definition.title.trim() : ''
  if (title.length === 0 || title.length > MAX_MINI_APP_TITLE_LENGTH) {
    throw new TypeError('mini app title must be 1-32 characters')
  }
  if (typeof definition.create !== 'function') throw new TypeError('mini app create must be a function')
  return Object.freeze({
    id: definition.id,
    title,
    ...(definition.icon ? { icon: definition.icon } : {}),
    create: definition.create,
  })
}

export class MiniAppRegistry implements MiniAppRegistryCapability {
  #definitions = new Map<string, MiniAppDefinition>()
  #listeners = new Set<RegistryListener>()

  register(definition: MiniAppDefinition): () => void {
    const validated = validateDefinition(definition)
    if (this.#definitions.has(validated.id)) throw new Error(`mini app id is already registered: ${validated.id}`)
    this.#definitions.set(validated.id, validated)
    this.#notify()
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#definitions.get(validated.id) !== validated) return
      this.#definitions.delete(validated.id)
      this.#notify()
    }
  }

  get(id: string): MiniAppDefinition | undefined {
    return this.#definitions.get(id)
  }

  list(): RegisteredMiniApp[] {
    return [...this.#definitions.values()]
      .map(({ id, title, icon }) => Object.freeze({ id, title, ...(icon ? { icon } : {}) }))
      .sort((left, right) => left.title.localeCompare(right.title))
  }

  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
