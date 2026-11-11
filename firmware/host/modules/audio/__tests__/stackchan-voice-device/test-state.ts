export type StackchanVoiceTestState = {
  constructors: Array<{ preset: number; resourceName: string }>
  koes: Array<{ koe: string; speed: number }>
  says: Array<{ speed: number; text: string }>
}

export const state: StackchanVoiceTestState = {
  constructors: [],
  koes: [],
  says: [],
}
