import { Application, type Content as PiuContent } from 'piu/MC'
import { DogFace } from 'behaviors/face'
import type { DrawerButtonSpec } from 'drawer'
import { AppController } from 'app-controller'
import { RendererCompat } from 'renderer-compat'

export type Effect = PiuContent

type RendererOptions = {
  drawerButtons?: DrawerButtonSpec[]
}

export function createRenderer(options?: RendererOptions): AppController {
  const application = new Application(
    {
      face: new DogFace(),
      drawerButtons: options?.drawerButtons,
    },
    { displayListLength: 2048, contents: [], Behavior: AppController },
  )
  return application.behavior as AppController
}

export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ controller: createRenderer(options) })
  }
}
