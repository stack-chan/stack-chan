export type AppBehaviorModules<TBehavior> = {
  has(specifier: string): boolean
  importNow(specifier: string): TBehavior
}

export function resolveAppBehaviors<TBehavior>(
  modules: AppBehaviorModules<TBehavior>,
  defaultBehavior: TBehavior,
): TBehavior[] {
  if (modules.has('mod')) {
    return [modules.importNow('mod')]
  }
  return [defaultBehavior]
}
