export function rollbackExperimentalMiniAppRegistrations(
  unregister: readonly (() => void)[],
  onError: (error: unknown) => void,
): void {
  for (let index = unregister.length - 1; index >= 0; index -= 1) {
    try {
      unregister[index]()
    } catch (error) {
      onError(error)
    }
  }
}
