import * as MiniAppPiuNamespace from 'experimental-mini-app-piu'
import { rollbackExperimentalMiniAppRegistrations } from 'experimental-mini-app-registration'
import type { MiniAppDefinition, MiniAppRegistryCapability } from 'mini-app'
import Modules from 'modules'
import * as TimelineNamespace from 'piu/Timeline'

type ModuleDescriptor = { archive: unknown; path: string } | { namespace: Record<string, unknown> }

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

const ALLOWED_MINI_APP_IMPORTS = Object.freeze(['miniapp', 'piu/MC', 'piu/Timeline'] as const)

declare const Compartment: MiniAppCompartmentConstructor | undefined

export function isMiniAppImportAllowed(specifier: string): boolean {
  return (ALLOWED_MINI_APP_IMPORTS as readonly string[]).includes(specifier)
}

function createPiuEndowments(): Record<string, unknown> {
  // Compartment shares native Piu constructors reliably through an actual
  // module namespace. The wrapper module exports only the approved subset.
  return MiniAppPiuNamespace as unknown as Record<string, unknown>
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
    // Moddable's Piu typings compile constructors as ambient globals even when
    // TypeScript source imports piu/MC, so expose the same attenuated subset in
    // both forms. Application and all host capabilities remain excluded.
    const globals = Object.freeze({ archive, ...piu })
    const compartment = new Compartment({
      // The archive capability is limited to resources bundled in this mod.
      globals,
      modules: {
        miniapp: { archive, path: 'miniapp' },
        'piu/MC': { namespace: piu },
        'piu/Timeline': { namespace: TimelineNamespace as unknown as Record<string, unknown> },
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
    rollbackExperimentalMiniAppRegistrations(unregister, (rollbackError) => {
      trace(`[MiniApp] experimental archive rollback failed error=${String(rollbackError)}\n`)
    })
    trace(`[MiniApp] experimental archive registration rolled back error=${String(error)}\n`)
  }
}
