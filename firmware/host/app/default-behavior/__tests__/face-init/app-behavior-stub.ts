// Test-only type boundary for app-default-behavior/on-context-created.
export type StackchanAppBehaviorOption = {
  config: { ui: { type?: unknown }; [domain: string]: unknown }
}

export interface StackchanAppBehavior {
  onLaunch?: (option: { config?: unknown }) => Promise<boolean> | boolean
  onContextCreated?: (
    // biome-ignore lint/suspicious/noExplicitAny: this stub isolates the test from the full app context dependency graph.
    robot: any,
    option: StackchanAppBehaviorOption,
  ) => Promise<void> | void
  onClose?: () => Promise<void> | void
}
