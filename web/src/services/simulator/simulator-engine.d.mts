export type SimulatorStatus = {
  status: 'pending' | 'success' | 'error'
  message: string
}

export type SimulatorModResult = {
  status: 'empty' | 'saved' | 'prepared' | 'installed' | 'unsupported' | 'restarting' | 'error'
  name?: string
  size?: number
  error?: string
}

export type InstalledMod = {
  name: string
  size: number
  storage?: 'memory' | 'indexedDB'
}

export type StoredMod = InstalledMod & {
  bytes: Uint8Array
  installedAt?: number
}

export type SimulatorModStorage = {
  saveInstalledMod(mod: { name: string; bytes: Uint8Array }): Promise<StoredMod>
  loadInstalledMod(): Promise<StoredMod | null>
  clearInstalledMod(): Promise<void>
}

export type CameraStatus = {
  status: 'idle' | 'pending' | 'connected' | 'fallback' | 'error'
  error?: string
}

export type SimulatorReady = {
  runCount: number
  installationStatus: SimulatorModResult['status']
}

export class SimulatorEngine {
  constructor(options: {
    viewport: HTMLCanvasElement
    screen: HTMLCanvasElement
    runtimeBaseUrl?: string
    modStorage?: SimulatorModStorage
    onStatus?: (status: SimulatorStatus) => void
    onTrace?: (message: string) => void
    onModStatus?: (result: SimulatorModResult, installedMod?: InstalledMod | null) => void
    onCameraStatus?: (status: CameraStatus) => void
    onReady?: (ready: SimulatorReady) => void
    onError?: (error: unknown) => void
  })
  start(): Promise<void>
  installMod(file: File): Promise<void>
  restart(): Promise<void>
  clearMod(): Promise<void>
  connectCamera(): Promise<void>
  pushButton(name: 'a' | 'b' | 'c'): void
  dispose(): void
}
