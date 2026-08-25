import type { RemoteConversationSession, StackchanContext } from 'capabilities'

export const STACKCHAN_DOCK_MODULE = 'stackchan-dock'

export type StackchanDockRuntime = {
  readonly remoteConversationSession?: RemoteConversationSession
  onContextCreated(context: StackchanContext): void
  close(): void
}

export type StackchanDock = {
  start(modConfig?: unknown): StackchanDockRuntime | undefined
}

export type StackchanDockModules = {
  has(specifier: string): boolean
  importNow(specifier: string): unknown
}

export function startStackchanDock(
  modules: StackchanDockModules,
  modConfig?: unknown,
): StackchanDockRuntime | undefined {
  if (!modules.has(STACKCHAN_DOCK_MODULE)) return
  const dock = modules.importNow(STACKCHAN_DOCK_MODULE)
  if (!isStackchanDock(dock)) {
    throw new TypeError(`${STACKCHAN_DOCK_MODULE} does not export a StackchanDock`)
  }
  const runtime = dock.start(modConfig)
  if (runtime === undefined) return
  if (!isStackchanDockRuntime(runtime)) {
    throw new TypeError(`${STACKCHAN_DOCK_MODULE} returned an invalid runtime`)
  }
  return runtime
}

function isStackchanDock(value: unknown): value is StackchanDock {
  return typeof value === 'object' && value !== null && typeof (value as StackchanDock).start === 'function'
}

function isStackchanDockRuntime(value: unknown): value is StackchanDockRuntime {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StackchanDockRuntime).onContextCreated === 'function' &&
    typeof (value as StackchanDockRuntime).close === 'function'
  )
}
