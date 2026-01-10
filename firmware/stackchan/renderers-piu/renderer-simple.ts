import { Application } from 'piu/MC'
import { SimpleFace } from 'behaviors/face'
import type { DrawerButtonSpec } from 'drawer'
import type { Effect } from 'main-view'
import { AppController } from 'app-controller'
import { RendererCompat } from 'renderer-compat'

export type { Effect }

type RendererOptions = {
  drawerButtons?: DrawerButtonSpec[]
}

export function createRenderer(options?: RendererOptions): AppController {
  const application = new Application(
    {
      face: new SimpleFace(),
      drawerButtons: options?.drawerButtons,
    },
    { displayListLength: 2048, contents: [], Behavior: AppController },
  )
  return application.behavior as AppController
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ controller: createRenderer(options) })
  }
}
