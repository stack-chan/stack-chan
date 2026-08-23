export type AppBehaviorModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

export function resolveAppBehaviors<TBehavior extends object>(
  modules: AppBehaviorModules,
  defaultBehavior: TBehavior,
  onImportError?: (error: unknown) => void,
): TBehavior[] {
  if (modules.has('mod')) {
    try {
      return [mergeDefinedBehavior(defaultBehavior, modules.importNow('mod') as Partial<TBehavior>)]
    } catch (error) {
      onImportError?.(error)
    }
  }
  return [defaultBehavior]
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
