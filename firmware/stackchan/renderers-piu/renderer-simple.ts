import { AppController } from 'app-controller'
import { SimpleFace } from 'behaviors/face'
import { ChatStatusBar } from 'chat-status-bar'
import type { DrawerButtonSpec } from 'drawer'
import { Application, type Content as PiuContent } from 'piu/MC'
import { RendererCompat } from 'renderer-compat'

export type Effect = PiuContent

type RendererOptions = {
  drawerButtons?: DrawerButtonSpec[]
  displayListLength?: number
}

export function createRenderer(options?: RendererOptions): AppController {
  const application = new Application(
    {
      face: new SimpleFace(),
      appBar: new ChatStatusBar(),
      drawerButtons: options?.drawerButtons,
    },
    { displayListLength: options?.displayListLength ?? 2048, contents: [], Behavior: AppController },
  )
  return application.behavior as AppController
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ controller: createRenderer(options) })
  }
}
