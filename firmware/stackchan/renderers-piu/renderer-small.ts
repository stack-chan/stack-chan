import { createSmallFaceContainer } from 'behaviors/face'
import { Main, type Effect } from 'main-view'
import { RendererCompat } from 'renderer-compat'

export type { Effect }

export function createRenderer(): Main {
  return new Main({ face: createSmallFaceContainer() })
}

export class Renderer extends RendererCompat {
  constructor() {
    super({ main: createRenderer() })
  }
}
