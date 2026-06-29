// Test-only type boundary for default-mods/on-robot-created.
export interface StackchanMod {
  // biome-ignore lint/suspicious/noExplicitAny: this stub isolates the test from the full app context dependency graph.
  onRobotCreated?: (robot: any, option?: unknown) => Promise<void> | void
}
