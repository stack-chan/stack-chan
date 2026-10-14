import config from 'mc/config'
import type { Application as PiuApplication } from 'piu/MC'
import { Label } from 'piu/MC'

export type StackchanContext = {
  ui: { miniApps: unknown }
  lifecycle: { close(): Promise<void> }
}
export type StackchanDockRuntime = {
  close(): void
  onContextCreated(context: StackchanContext): void
  remoteConversationSession?: unknown
}
export type BootWiFiStatus = { attempt: number; maxAttempts: number; message: string }
export type PreferenceConfig = Record<string, Record<string, unknown>>
export type TestState = {
  phase: 'early' | 'launch' | 'network' | 'context' | 'behavior' | 'success'
  error: unknown
  replaceUI: boolean
  closeCount: number
  dockCloseCount: number
  closeError?: unknown
  close?: () => Promise<void>
  status?: (status: BootWiFiStatus) => void
  replaceOnClose?: boolean
}
const testConfig = config as Record<string, unknown>
const environment = globalThis as typeof globalThis & {
  startupErrorTestState?: TestState
  application?: PiuApplication
}
if (!environment.startupErrorTestState) {
  environment.startupErrorTestState = {
    phase: (testConfig.startupErrorPhase as TestState['phase']) ?? 'context',
    error: new RangeError('password=fixture-secret token=fixture-token'),
    replaceUI: true,
    closeCount: 0,
    dockCloseCount: 0,
    closeError: testConfig.startupErrorCleanupFailure ? new TypeError('password=cleanup-secret') : undefined,
    replaceOnClose: testConfig.startupErrorReplaceOnClose === true,
  }
}
export const state = environment.startupErrorTestState

export default function loadPreferences(_domain?: unknown): Record<string, unknown> {
  return { language: 'en', timezone: 'UTC' }
}
export function loadModConfig() {
  return {}
}
export function loadPreferenceConfig(): PreferenceConfig {
  return {}
}
export function applyTimezone(_timezone?: unknown) {}
export function prepareExperimentalMiniApps() {
  return []
}
export function registerExperimentalMiniApps(_prepared: unknown, _registry: unknown) {}
export function getHostDeviceEnvironment() {
  return {}
}
export function startStackchanDock(_modules: unknown, _config: unknown): StackchanDockRuntime {
  if (state.phase === 'early') throw state.error
  return {
    close() {
      state.dockCloseCount++
      if (state.closeError !== undefined) throw state.closeError
    },
    onContextCreated() {},
  }
}
export function onLaunch() {
  if (state.phase === 'launch') throw state.error
  return true
}
export function onContextCreated() {
  if (state.phase === 'behavior') throw state.error
}
export function startHostBootServices(options: {
  wifi: {
    onStatusChanged(status: BootWiFiStatus): void
    promptRecoveryChoice(status: BootWiFiStatus & { reason: string }): Promise<'retry' | 'offline'>
  }
}) {
  state.status = options.wifi.onStatusChanged
  return {
    connectivity: {
      network: {
        ready: state.phase === 'network' ? Promise.reject(state.error) : Promise.resolve({ status: 'skipped' }),
      },
    },
  }
}
export function createStackchanContext(_preferences: unknown, _options: unknown): StackchanContext {
  if (state.replaceUI) {
    environment.application?.empty()
    environment.application?.add(
      new Label(null, { string: 'face application', top: 0, left: 0, width: 320, height: 40 }),
    )
  }
  if (state.phase === 'context') throw state.error
  return {
    ui: { miniApps: {} },
    lifecycle: {
      async close() {
        state.closeCount++
        await state.close?.()
        if (state.replaceOnClose) {
          environment.application?.empty()
          environment.application?.add(
            new Label(null, { string: 'New screen', top: 0, left: 0, width: 320, height: 40 }),
          )
        }
        if (state.closeError !== undefined) throw state.closeError
      },
    },
  }
}
