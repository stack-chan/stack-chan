let applications: unknown[] = []

export function startSetupMode(application: unknown): void {
  applications.push(application)
}

export function startedSetupModeApplications(): unknown[] {
  return applications
}

export function resetSetupModeCalls(): void {
  applications = []
}
