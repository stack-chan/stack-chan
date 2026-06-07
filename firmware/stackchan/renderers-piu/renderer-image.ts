import type { Content as PiuContent } from 'piu/MC'
import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import type { DrawerButtonSpec } from 'drawer'
import { type AppController, createAppControllerApplication } from 'app-controller'
import { RendererCompat } from 'renderer-compat'
import { ChatStatusBar } from 'chat-status-bar'

export type Effect = PiuContent

type RendererOptions = {
  avatar?: string
  drawerButtons?: DrawerButtonSpec[]
}

export function createRenderer(options?: RendererOptions): AppController {
  return createAppControllerApplication(
    {
      face: new ImageAvatarFace({ pack: options?.avatar }),
      appBar: new ChatStatusBar(),
      drawerButtons: options?.drawerButtons,
    },
    { displayListLength: 4096 },
  )
}

export class Renderer extends RendererCompat {
  constructor(options?: RendererOptions) {
    super({ controller: createRenderer(options) })
  }
}
