import type { MiniAppDefinition, MiniAppRegistryCapability } from 'mini-app'
import Modules from 'modules'
import * as MCNamespace from 'piu/MC'
import Timeline from 'piu/Timeline'

type VirtualModuleEnvironment = Record<string, unknown>

type VirtualModuleSource = {
  bindings: Array<{ export: string }>
  execute(environment: VirtualModuleEnvironment): void
}

type ModuleDescriptor = { archive: unknown; path: string } | { source: VirtualModuleSource }

type MiniAppCompartment = {
  importNow(specifier: string): Record<string, unknown>
}

type MiniAppCompartmentConstructor = new (options: {
  globals: Record<string, unknown>
  modules: Record<string, ModuleDescriptor>
  resolveHook(specifier: string, referrer: string): string
}) => MiniAppCompartment

type MiniAppHostGlobals = typeof globalThis & {
  archive?: unknown
  Compartment?: MiniAppCompartmentConstructor
}

type ModulesLike = {
  has(specifier: string): boolean
}

export type ExperimentalMiniAppPack = Readonly<{
  definitions: readonly MiniAppDefinition[]
  compartment: MiniAppCompartment
}>

const ALLOWED_PIU_EXPORTS = Object.freeze([
  'Behavior',
  'Column',
  'Container',
  'Content',
  'Die',
  'Label',
  'Layout',
  'Port',
  'Row',
  'Scroller',
  'Skin',
  'Style',
  'Text',
  'Texture',
  'Transition',
  'blendColors',
  'hsl',
  'hsla',
  'rgb',
  'rgba',
  'template',
] as const)

const ALLOWED_MINI_APP_IMPORTS = Object.freeze(['miniapp', 'piu/MC', 'piu/Timeline'] as const)

declare const Compartment: MiniAppCompartmentConstructor | undefined

export function isMiniAppImportAllowed(specifier: string): boolean {
  return (ALLOWED_MINI_APP_IMPORTS as readonly string[]).includes(specifier)
}

function createVirtualModule(exports: Record<string, unknown>): ModuleDescriptor {
  const names = Object.keys(exports)
  return {
    source: {
      bindings: names.map((name) => ({ export: name })),
      execute(environment) {
        for (const name of names) environment[name] = exports[name]
      },
    },
  }
}

function createPiuEndowments(): Record<string, unknown> {
  const namespace = MCNamespace as unknown as Record<string, unknown>
  const endowments: Record<string, unknown> = {}
  for (const name of ALLOWED_PIU_EXPORTS) {
    const value = namespace[name]
    if (value !== undefined) endowments[name] = value
  }
  return Object.freeze(endowments)
}

function defaultMiniAppHostGlobals(): MiniAppHostGlobals {
  const globals = globalThis as MiniAppHostGlobals
  return {
    archive: globals.archive,
    // The direct reference keeps the intrinsic when the XS linker strips unused built-ins.
    Compartment: typeof Compartment === 'function' ? Compartment : globals.Compartment,
  } as MiniAppHostGlobals
}

function readDefinitions(namespace: Record<string, unknown>): readonly MiniAppDefinition[] {
  const definitions = namespace.default
  if (!Array.isArray(definitions)) throw new TypeError('experimental miniapp default export must be an array')
  return definitions as readonly MiniAppDefinition[]
}

export function prepareExperimentalMiniApps(
  modules: ModulesLike = Modules,
  hostGlobals: MiniAppHostGlobals = defaultMiniAppHostGlobals(),
): ExperimentalMiniAppPack | null {
  if (!modules.has('miniapp')) return null
  const archive = hostGlobals.archive
  const Compartment = hostGlobals.Compartment
  if (!archive || !Compartment) {
    trace('[MiniApp] experimental archive unavailable: missing archive or Compartment\n')
    return null
  }

  try {
    const piu = createPiuEndowments()
    const globals = Object.freeze({ archive })
    const timeline = Object.freeze({ default: Timeline })
    const compartment = new Compartment({
      // Piu is available only through the attenuated virtual modules below.
      // The archive capability is limited to resources bundled in this mod.
      globals,
      modules: {
        miniapp: { archive, path: 'miniapp' },
        'piu/MC': createVirtualModule(piu),
        'piu/Timeline': createVirtualModule(timeline),
      },
      resolveHook(specifier) {
        if (isMiniAppImportAllowed(specifier)) return specifier
        throw new URIError(`mini app import is not allowed: ${specifier}`)
      },
    })
    const definitions = readDefinitions(compartment.importNow('miniapp'))
    trace(`[MiniApp] loaded experimental archive definitions=${definitions.length}\n`)
    return Object.freeze({ definitions, compartment })
  } catch (error) {
    trace(`[MiniApp] experimental archive rejected error=${String(error)}\n`)
    return null
  }
}

export function registerExperimentalMiniApps(
  pack: ExperimentalMiniAppPack | null,
  registry: MiniAppRegistryCapability,
): void {
  if (!pack) return
  const unregister: Array<() => void> = []
  try {
    for (const definition of pack.definitions) unregister.push(registry.register(definition))
  } catch (error) {
    for (let index = unregister.length - 1; index >= 0; index -= 1) unregister[index]()
    trace(`[MiniApp] experimental archive registration rolled back error=${String(error)}\n`)
  }
}
