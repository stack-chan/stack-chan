// Explicit, synchronous snapshots only. No Worker, transport, timer or GC.
export function snapshot() {
  return native('xs_stackchan_heap_snapshot').call(null)
}
