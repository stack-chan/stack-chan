let calls = 0

export function showStartupSplash(): unknown {
  calls += 1
  return { type: 'startup-splash' }
}

export function startupSplashCallCount(): number {
  return calls
}

export function resetStartupSplashCalls(): void {
  calls = 0
}
