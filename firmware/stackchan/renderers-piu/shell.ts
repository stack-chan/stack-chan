import type { Application as PiuApplication, Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { Main } from 'main-view'
import { createDrawer, type DrawerBehavior, type DrawerButtonSpec } from 'drawer'
import type { FaceContext } from 'face-context'

export type ShellOptions = {
  main: Main
  appBarFactory?: () => PiuContent
  drawerButtons?: DrawerButtonSpec[]
  drawerFactory?: () => PiuContainer
  overlayFactory?: () => PiuContainer
  themeSync?: boolean
}

export class Shell {
  #application: PiuApplication
  #appBar: PiuContent | null
  #body: PiuContainer
  #overlay: PiuContainer
  #drawer: PiuContainer | null
  #drawerOpen: boolean

  constructor(options: ShellOptions) {
    const main = options.main
    const app = main.application
    const shell = this

    // remove existing main container from root and rebuild layout
    app.remove(main.mainContainer)

    this.#appBar = options.appBarFactory
      ? options.appBarFactory()
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
      contents: [main.mainContainer].filter(Boolean) as PiuContent[],
      Behavior: class extends Behavior {
        onFaceContext(_container: PiuContainer, faceContext: FaceContext) {
          main.effectsContainer.distribute('onFaceContext', faceContext)
          shell.#overlay.distribute('onFaceContext', faceContext)
          shell.#appBar?.distribute?.('onFaceContext', faceContext)
          return true
        }
      },
    })

    const contents: PiuContent[] = []
    contents.push(this.#body)
    if (this.#appBar) contents.push(this.#appBar)
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
    if (!drawer || !behavior?.setOpen || this.#drawerOpen) return
    this.#drawerOpen = true
    this.#overlay.active = true
    behavior.setOpen(drawer, true)
  }

  closeDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (!drawer || !behavior?.setOpen || !this.#drawerOpen) return
    this.#drawerOpen = false
    this.#overlay.active = false
    behavior.setOpen(drawer, false)
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

  setAppBar(_content: PiuContent): void {
    // TODO: implement app bar replacement if needed
  }
}
