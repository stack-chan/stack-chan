let applications: unknown[] = []
let resolveChoice: ((choice: 'back' | 'boot') => void) | undefined

export function startSetupMode(application: unknown): Promise<'back' | 'boot'> {
  applications.push(application)
  return new Promise((resolve) => {
    resolveChoice = resolve
  })
}

export function startedSetupModeApplications(): unknown[] {
  return applications
}

export function resetSetupModeCalls(): void {
  applications = []
  resolveChoice = undefined
}

export function finishSetupMode(choice: 'back' | 'boot'): void {
  const resolve = resolveChoice
  resolveChoice = undefined
  resolve?.(choice)
}
