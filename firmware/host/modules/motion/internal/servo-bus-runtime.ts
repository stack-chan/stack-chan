import { ServoBusRegistry } from 'servo-bus'
import Timer from 'timer'

let registry: ServoBusRegistry | undefined

export function getServoBuses(): ServoBusRegistry {
  // Preloaded XS objects live in ROM. Allocate mutable ownership maps at runtime.
  if (!registry) {
    registry = new ServoBusRegistry(
      {
        set: (callback, ms) => Timer.set(callback, ms),
        clear: (handle) => Timer.clear(handle as ReturnType<typeof Timer.set>),
      },
      (error) => trace(`[servo-bus] callback failed: ${String(error)}\n`),
    )
  }
  return registry
}
