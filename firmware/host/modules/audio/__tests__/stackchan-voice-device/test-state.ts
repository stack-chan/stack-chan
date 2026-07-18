export type StackchanVoiceTestState = {
  audio: {
    bitsPerSample?: number
    channels?: number
    closed: number
    sampleRate?: number
    started: number
    stopped: number
    volume?: number
    writes: number[][]
    writesAreUint8Arrays: boolean[]
  }
  constructors: Array<{ preset: number; resourceName: string }>
  koes: Array<{ koe: string; speed: number }>
  says: Array<{ speed: number; text: string }>
}

export const state: StackchanVoiceTestState = {
  audio: {
    closed: 0,
    started: 0,
    stopped: 0,
    writes: [],
    writesAreUint8Arrays: [],
  },
  constructors: [],
  koes: [],
  says: [],
}

export function resetState(): void {
  state.audio = {
    closed: 0,
    started: 0,
    stopped: 0,
    writes: [],
    writesAreUint8Arrays: [],
  }
  state.constructors.length = 0
  state.koes.length = 0
  state.says.length = 0
}
