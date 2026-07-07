import { createAppControllerApplication } from 'app-controller'
import type { RobotUI } from 'capabilities'
import { ChatStatusBar } from 'chat-status-bar'
import type { DrawerButtonSpec } from 'drawer'
import type { Container as PiuContainer } from 'piu/MC'

export type StackchanUIOptions = {
  avatar?: string
  drawerButtons?: DrawerButtonSpec[]
  displayListLength?: number
}

export function asStackchanUIOptions(param: unknown): StackchanUIOptions {
  return (param ?? {}) as StackchanUIOptions
}

export function createRegisteredStackchanUI(
  face: PiuContainer,
  options: StackchanUIOptions = {},
  displayListLength = 2048,
): RobotUI {
  return createAppControllerApplication(
    {
      face,
      appBar: new ChatStatusBar(),
      drawerButtons: options.drawerButtons,
    },
    { displayListLength },
  )
}
