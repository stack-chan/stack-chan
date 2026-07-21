declare module 'capabilities' {
  import type { Container as PiuContainer } from 'piu/MC'

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

  export type MiniAppRegistryCapability = Readonly<{
    register(definition: MiniAppDefinition): () => void
  }>
}
