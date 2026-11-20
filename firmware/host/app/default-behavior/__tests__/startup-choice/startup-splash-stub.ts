let calls = 0
let onMods: (() => void) | undefined
let onSettings: (() => void) | undefined

export function showStartupSplash(options: { onMods?: () => void; onSettings?: () => void } = {}): unknown {
  calls += 1
  onMods = options.onMods
  onSettings = options.onSettings
  return { type: 'startup-splash' }
}

export function startupSplashCallCount(): number {
  return calls
}

export function resetStartupSplashCalls(): void {
  calls = 0
  onMods = undefined
  onSettings = undefined
}

export function pressStartupMods(): void {
  onMods?.()
}

export function pressStartupSettings(): void {
  onSettings?.()
}
