import { createDogFaceContainer } from 'behaviors/face'
import { Main, type Effect } from './main-view'

export type { Effect }

export function createRenderer(): Main {
  return new Main({ face: createDogFaceContainer() })
}

export class Renderer extends Main {
  constructor() {
    super({ face: createDogFaceContainer() })
  }
}
