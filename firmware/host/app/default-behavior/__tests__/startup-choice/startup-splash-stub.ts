let calls = 0
let onSettings: (() => void) | undefined

export function showStartupSplash(options: { onSettings?: () => void } = {}): unknown {
  calls += 1
  onSettings = options.onSettings
  return { type: 'startup-splash' }
}

export function startupSplashCallCount(): number {
  return calls
}

export function resetStartupSplashCalls(): void {
  calls = 0
  onSettings = undefined
}

export function pressStartupSettings(): void {
  onSettings?.()
}
