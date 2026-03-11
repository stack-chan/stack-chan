import { createSimpleFaceContainer } from 'behaviors/face'
import { Main, type Effect } from './main-view'

export type { Effect }

export function createRenderer(): Main {
  return new Main({ face: createSimpleFaceContainer() })
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends Main {
  constructor() {
    super({ face: createSimpleFaceContainer() })
  }
}
