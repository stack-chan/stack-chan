import { createSmallFaceContainer } from 'behaviors/face'
import { Main, type Effect } from './main-view'

export type { Effect }

export function createRenderer(): Main {
  return new Main({ face: createSmallFaceContainer() })
}

export class Renderer extends Main {
  constructor() {
    super({ face: createSmallFaceContainer() })
  }
}
