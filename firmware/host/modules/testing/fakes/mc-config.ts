type TestConfig = {
  touchCount?: number
  touchIntervalMs?: number
  touchReleaseDebounceMs?: number
  [key: string]: unknown
}

const config: TestConfig = {}

export function resetConfig(values: TestConfig = {}): void {
  for (const key of Object.keys(config)) {
    delete config[key]
  }
  Object.assign(config, values)
}

export default config
