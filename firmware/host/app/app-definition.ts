import type { AppDefinition } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'

export type AppModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

/** Call only after archive preflight; module evaluation may have side effects. */
export function resolveAppDefinition(modules: AppModules, defaultApp: AppDefinition): AppDefinition {
  if (!modules.has('mod')) return defaultApp
  const candidate = modules.importNow('mod')
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('apiVersion' in candidate) ||
    candidate.apiVersion !== 2 ||
    !('setup' in candidate) ||
    typeof candidate.setup !== 'function'
  )
    throw new StackchanError('CONFIG', 'Unsupported MOD definition. Rewrite with defineApp and rebuild for app API 2.')
  return candidate as AppDefinition
}
