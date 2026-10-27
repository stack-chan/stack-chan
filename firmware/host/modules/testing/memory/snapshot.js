// Test-only, on-demand native heap snapshot. No timers or transport dependency.
export default function snapshot() {
  return native('xs_memory_diagnostics_snapshot')()
}
