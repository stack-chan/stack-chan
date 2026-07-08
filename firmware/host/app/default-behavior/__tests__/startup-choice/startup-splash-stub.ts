let calls = 0
let onTouch: (() => void) | undefined

export function showStartupSplash(options: { onTouch?: () => void } = {}): unknown {
  calls += 1
  onTouch = options.onTouch
  return { type: 'startup-splash' }
}

export function startupSplashCallCount(): number {
  return calls
}

export function resetStartupSplashCalls(): void {
  calls = 0
  onTouch = undefined
}

export function touchStartupSplash(): void {
  onTouch?.()
}
