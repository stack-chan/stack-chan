import { type AppController, createAppControllerApplication } from 'app-controller'
import { DogFace } from 'behaviors/face'
import { ChatStatusBar } from 'chat-status-bar'
import type { DrawerButtonSpec } from 'drawer'
import type { Content as PiuContent } from 'piu/MC'
import { RendererCompat } from 'renderer-compat'

export type Effect = PiuContent

type RendererOptions = {
  drawerButtons?: DrawerButtonSpec[]
  displayListLength?: number
}

export function createRenderer(options?: RendererOptions): AppController {
  return createAppControllerApplication(
    {
      face: new DogFace(),
      appBar: new ChatStatusBar(),
      drawerButtons: options?.drawerButtons,
    },
    { displayListLength: options?.displayListLength ?? 2048 },
  )
}

export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ controller: createRenderer(options) })
  }
}
