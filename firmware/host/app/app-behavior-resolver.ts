import type { AppDefinition } from 'stackchan/app'

export type AppBehaviorModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

export type AppProgram<TBehavior> = { generation: 1; behaviors: TBehavior[] } | { generation: 2; app: AppDefinition }

/** V2 apps have their own lifecycle and never inherit V1 default hooks. */
export function resolveAppProgram<TBehavior extends object>(
  modules: AppBehaviorModules,
  defaultBehavior: TBehavior,
  expectedAppApiVersion?: 1 | 2,
): AppProgram<TBehavior> {
  if (!modules.has('mod')) return { generation: 1, behaviors: [defaultBehavior] }
  const candidate = modules.importNow('mod')
  if (!candidate || typeof candidate !== 'object') throw new Error('MOD must export an app definition')
  const generation = 'apiVersion' in candidate ? candidate.apiVersion : 1
  if (expectedAppApiVersion !== undefined && generation !== expectedAppApiVersion)
    throw new Error('MOD export does not match its declared app API generation')
  if ('apiVersion' in candidate) {
    if (candidate.apiVersion !== 2 || !('setup' in candidate) || typeof candidate.setup !== 'function') {
      throw new Error('Unsupported MOD app API version or missing setup')
    }
    return { generation: 2, app: candidate as AppDefinition }
  }
  return { generation: 1, behaviors: [mergeDefinedBehavior(defaultBehavior, candidate)] }
}

function mergeDefinedBehavior<TBehavior extends object>(
  defaultBehavior: TBehavior,
  modBehavior: Partial<TBehavior>,
): TBehavior {
  const behavior = { ...defaultBehavior }
  for (const key of Object.keys(modBehavior) as Array<keyof TBehavior>) {
    const value = modBehavior[key]
    if (value !== undefined) {
      behavior[key] = value
    }
  }
  return behavior
}
