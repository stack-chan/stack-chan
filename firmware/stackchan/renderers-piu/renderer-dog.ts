import { createDogFaceContainer } from 'behaviors/face'
import type { DrawerButtonSpec } from 'drawer'
import { Main, type Effect } from 'main-view'
import { RendererCompat } from 'renderer-compat'
import { Shell } from 'shell'

export type { Effect }

type RendererOptions = {
  drawerButtons?: DrawerButtonSpec[]
}

export function createRenderer(options?: RendererOptions): Main {
  const main = new Main({ face: createDogFaceContainer() })
  new Shell({ main, drawerButtons: options?.drawerButtons })
  return main
}

export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ main: createRenderer(options) })
  }
}
