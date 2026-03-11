import type { Application as PiuApplication, Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { Face } from './renderer-base'
import { createDrawer, type DrawerBehavior, type DrawerButtonSpec } from './drawer'

export type ShellOptions = {
  face: Face
  headerFactory?: () => PiuContent
  drawerButtons?: DrawerButtonSpec[]
  drawerFactory?: () => PiuContainer
  overlayFactory?: () => PiuContainer
  themeSync?: boolean
}

export class Shell {
  #application: PiuApplication
  #header: PiuContent | null
  #body: PiuContainer
  #overlay: PiuContainer
  #drawer: PiuContainer | null

  constructor(options: ShellOptions) {
    const face = options.face
    const app = face.application

    // remove existing face/effect containers from root and rebuild layout
    app.remove(face.faceContainer)
    app.remove(face.effectContainer)

    this.#header = options.headerFactory
      ? options.headerFactory()
      : new Container(null, { left: 0, right: 0, top: 0, height: 24 })
    this.#drawer = options.drawerFactory ? options.drawerFactory() : createDrawer(options.drawerButtons)
    this.#body = new Container(null, {
      left: 0,
      right: 0,
      top: this.#header ? (this.#header.height ?? 24) : 0,
      bottom: 0,
      contents: [face.faceContainer, face.effectContainer].filter(Boolean) as PiuContent[],
    })
    if (this.#drawer) this.#body.add(this.#drawer)

    this.#overlay = options.overlayFactory
      ? options.overlayFactory()
      : new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          active: true,
          clip: false,
        })

    const contents: PiuContent[] = []
    if (this.#header) contents.push(this.#header)
    contents.push(this.#body)
    contents.push(this.#overlay)
    app.empty()
    for (const c of contents) app.add(c)

    this.#application = app
  }

  get application(): PiuApplication {
    return this.#application
  }

  openDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (drawer && behavior?.toggle) behavior.toggle(drawer)
  }

  closeDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (drawer && behavior?.isOpen === true && behavior.toggle) {
      behavior.toggle(drawer)
    }
  }

  showDialog(_content: PiuContent): void {
    // TODO: implement overlay/dialog UI
  }

  hideDialog(): void {
    // TODO: implement overlay/dialog UI
  }

  showToast(_content: PiuContent, _durationMs?: number): void {
    // TODO: implement overlay/toast UI
  }

  setHeader(_content: PiuContent): void {
    // TODO: implement header replacement if needed
  }
}
