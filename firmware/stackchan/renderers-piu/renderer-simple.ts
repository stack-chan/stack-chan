import { createSimpleFaceContainer } from 'behaviors/face'
import { Main, type Effect } from 'main-view'
import { RendererCompat } from 'renderer-compat'

export type { Effect }

export function createRenderer(): Main {
  return new Main({ face: createSimpleFaceContainer() })
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends RendererCompat {
  constructor() {
    super({ main: createRenderer() })
  }
}
