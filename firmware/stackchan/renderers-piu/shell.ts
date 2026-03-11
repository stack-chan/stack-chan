import type { Application as PiuApplication, Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import { Face } from './renderer-base'

export type ShellOptions = {
  face: Face
  headerFactory?: () => PiuContent
  drawerFactory?: () => PiuContainer
  overlayFactory?: () => PiuContainer
  themeSync?: boolean
}

/**
 * Minimal Shell wrapper. For now it just exposes the Application owned by Face.
 * Header/Drawer/Overlay integration will be added in future steps.
 */
export class Shell {
  #application: PiuApplication

  constructor(options: ShellOptions) {
    this.#application = options.face.application
    // Extension point: add header/drawer/overlay contents to the application here later
  }

  get application(): PiuApplication {
    return this.#application
  }

  openDrawer(): void {
    // TODO: implement when drawer UI is added
  }

  closeDrawer(): void {
    // TODO: implement when drawer UI is added
  }

  showDialog(_content: PiuContent): void {
    // TODO: implement when overlay/dialog UI is added
  }

  hideDialog(): void {
    // TODO: implement when overlay/dialog UI is added
  }

  showToast(_content: PiuContent, _durationMs?: number): void {
    // TODO: implement when overlay/toast UI is added
  }

  setHeader(_content: PiuContent): void {
    // TODO: implement when header UI is added
  }
}
