export type AppBehaviorModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

export type AppBehaviorResolutionOptions = Readonly<{
  allowModOverride?: boolean
}>

export function resolveAppBehaviors<TBehavior extends object>(
  modules: AppBehaviorModules,
  defaultBehavior: TBehavior,
  options: AppBehaviorResolutionOptions = {},
): TBehavior[] {
  if (options.allowModOverride !== false && modules.has('mod')) {
    return [mergeDefinedBehavior(defaultBehavior, modules.importNow('mod') as Partial<TBehavior>)]
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
