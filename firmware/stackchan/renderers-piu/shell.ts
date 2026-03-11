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
  #drawerOpen: boolean

  constructor(options: ShellOptions) {
    const face = options.face
    const app = face.application
    const shell = this

    // remove existing face/effect containers from root and rebuild layout
    app.remove(face.faceContainer)
    app.remove(face.effectContainer)

    this.#header = options.headerFactory
      ? options.headerFactory()
      : new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          height: 24,
          active: false,
          contents: [],
        })
    this.#overlay = options.overlayFactory
      ? options.overlayFactory()
      : new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          active: false,
          clip: false,
        })

    const overlayCatcher = new Content(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      backgroundTouch: true,
      Behavior: class extends Behavior {
        onTouchEnded() {
          if (shell.#drawerOpen) {
            shell.closeDrawer()
          } else {
            shell.toggleDrawer()
          }
        }
      },
    })
    this.#overlay.add(overlayCatcher)

    this.#drawer = options.drawerFactory ? options.drawerFactory() : createDrawer(options.drawerButtons, 0)
    if (this.#drawer) this.#overlay.add(this.#drawer)
    this.#body = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      contents: [face.faceContainer, face.effectContainer].filter(Boolean) as PiuContent[],
    })

    const contents: PiuContent[] = []
    contents.push(this.#body)
    if (this.#header) contents.push(this.#header)
    contents.push(this.#overlay)
    app.empty()
    for (const c of contents) app.add(c)

    this.#application = app
    this.#drawerOpen = false
  }

  get application(): PiuApplication {
    return this.#application
  }

  openDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (!drawer || !behavior?.toggle || this.#drawerOpen) return
    this.#drawerOpen = true
    this.#overlay.active = true
    behavior.toggle(drawer)
  }

  closeDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (!drawer || !behavior?.toggle || !this.#drawerOpen) return
    this.#drawerOpen = false
    this.#overlay.active = false
    behavior.toggle(drawer)
  }

  toggleDrawer(): void {
    if (this.#drawerOpen) {
      this.closeDrawer()
    } else {
      this.openDrawer()
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
