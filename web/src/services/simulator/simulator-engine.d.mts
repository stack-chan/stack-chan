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

export type CameraStatus = {
  status: 'idle' | 'pending' | 'connected' | 'fallback' | 'error'
  error?: string
}

export class SimulatorEngine {
  constructor(options: {
    viewport: HTMLCanvasElement
    screen: HTMLCanvasElement
    onStatus?: (status: SimulatorStatus) => void
    onTrace?: (message: string) => void
    onModStatus?: (result: SimulatorModResult, installedMod?: InstalledMod | null) => void
    onCameraStatus?: (status: CameraStatus) => void
  })
  start(): Promise<void>
  installMod(file: File): Promise<void>
  restart(): Promise<void>
  clearMod(): Promise<void>
  connectCamera(): Promise<void>
  pushButton(name: 'a' | 'b' | 'c'): void
  dispose(): void
}
