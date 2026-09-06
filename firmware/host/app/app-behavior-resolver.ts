import type { AppDefinition } from 'stackchan/app'
import type { StackchanAppBehavior } from './app-behavior.js'

export type AppBehaviorModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

export type AppProgram = { generation: 1; behavior: StackchanAppBehavior } | { generation: 2; app: AppDefinition }

/** The product default and installed SDK apps share one lifecycle. Legacy MODs inherit no hooks. */
export function resolveAppProgram(
  modules: AppBehaviorModules,
  defaultApp: AppDefinition,
  expectedAppApiVersion?: 1 | 2,
): AppProgram {
  if (!modules.has('mod')) return { generation: 2, app: defaultApp }
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
  return { generation: 1, behavior: candidate as StackchanAppBehavior }
}
