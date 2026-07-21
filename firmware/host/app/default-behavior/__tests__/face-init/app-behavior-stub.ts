// Test-only type boundary for app-default-behavior/on-context-created.
export interface StackchanAppBehavior {
  // biome-ignore lint/suspicious/noExplicitAny: this stub isolates the test from the full app context dependency graph.
  onContextCreated?: (robot: any, option?: unknown) => Promise<void> | void
}
