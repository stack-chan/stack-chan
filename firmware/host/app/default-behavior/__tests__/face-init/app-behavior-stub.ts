// Test-only type boundary for app-default-behavior/on-context-created.
export interface StackchanAppBehavior {
  onContextCreated?: (
    // biome-ignore lint/suspicious/noExplicitAny: this stub isolates the test from the full app context dependency graph.
    robot: any,
    option: { config: { ui: { type?: unknown }; [domain: string]: unknown } },
  ) => Promise<void> | void
}
