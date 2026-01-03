import {
  Application,
  Container,
  Content,
  type Application as PiuApplication,
  type Container as PiuContainer,
  type Content as PiuContent,
} from 'piu/MC'
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

export type DrawerButtonController = {
  setButtons: (buttons: DrawerButtonSpec[]) => void
  addButton: (button: DrawerButtonSpec) => void
  removeButton: (key: string) => void
  setButtonState: (key: string, active: boolean) => void
}

type DrawerControllerHost = {
  drawerController?: DrawerButtonController
  shellController?: {
    setFace?: (face: PiuContainer) => void
  }
}

export class Shell {
  #application: PiuApplication
  #main: Main
  #appBar: PiuContent | null
  #body: PiuContainer
  #overlay: PiuContainer
  #drawer: PiuContainer | null
  #drawerOpen: boolean
  #drawerButtons: DrawerButtonSpec[]
  #drawerStates: Map<string, boolean>

  constructor(options: ShellOptions) {
    const main = options.main
    const app = main.application
    const shell = this
    this.#main = main
    this.#drawerButtons = options.drawerButtons ?? []
    this.#drawerStates = new Map()

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
          active: true,
          clip: false,
        })
    this.#overlay.active = true

    const overlayCatcher = new Content(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      backgroundTouch: true,
      Behavior: class extends Behavior {
        onTouchEnded() {
          trace('[Shell] overlay touch end\n')
          if (shell.#drawerOpen) {
            trace('[Shell] request close drawer\n')
            shell.closeDrawer()
          } else {
            trace('[Shell] request open drawer\n')
            shell.toggleDrawer()
          }
        }
      },
    })
    this.#overlay.add(overlayCatcher)

    this.#drawer = options.drawerFactory ? options.drawerFactory() : createDrawer(this.#drawerButtons, 0)
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

    const controller: DrawerButtonController = {
      setButtons: (buttons: DrawerButtonSpec[]) => this.setDrawerButtons(buttons),
      addButton: (button: DrawerButtonSpec) => this.addDrawerButton(button),
      removeButton: (key: string) => this.removeDrawerButton(key),
      setButtonState: (key: string, active: boolean) => this.setDrawerButtonState(key, active),
    }
    const host = app as unknown as DrawerControllerHost
    host.drawerController = controller
    host.shellController = {
      setFace: (face: PiuContainer) => this.setFace(face),
    }

    this.attachBehavior()
  }

  get application(): PiuApplication {
    return this.#application
  }

  openDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    trace('[Shell] openDrawer called\n')
    if (!drawer || !behavior?.setOpen || this.#drawerOpen) return
    this.#drawerOpen = true
    behavior.setOpen(drawer, true)
  }

  closeDrawer(): void {
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    trace('[Shell] closeDrawer called\n')
    if (!drawer || !behavior?.setOpen || !this.#drawerOpen) return
    this.#drawerOpen = false
    behavior.setOpen(drawer, false)
  }

  toggleDrawer(): void {
    if (this.#drawerOpen) {
      this.closeDrawer()
    } else {
      this.openDrawer()
    }
  }

  setFace(face: PiuContainer): void {
    this.#main.setFaceContainer(face)
  }

  setDrawerButtons(buttons: DrawerButtonSpec[]): void {
    this.#drawerButtons = [...buttons]
    this.replaceDrawer()
  }

  addDrawerButton(button: DrawerButtonSpec): void {
    const index = this.#drawerButtons.findIndex((item) => item.key === button.key)
    if (index >= 0) {
      this.#drawerButtons[index] = button
    } else {
      this.#drawerButtons.push(button)
    }
    this.replaceDrawer()
  }

  setDrawerButtonState(key: string, active: boolean): void {
    this.#drawerStates.set(key, active)
    const drawer = this.#drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    const updated = behavior?.setButtonState?.(drawer, key, active)
    const index = this.#drawerButtons.findIndex((item) => item.key === key)
    if (index >= 0) {
      this.#drawerButtons[index] = { ...this.#drawerButtons[index], active }
    }
    if (!updated) {
      this.replaceDrawer()
    }
  }

  removeDrawerButton(key: string): void {
    const next = this.#drawerButtons.filter((item) => item.key !== key)
    if (next.length === this.#drawerButtons.length) return
    this.#drawerButtons = next
    this.replaceDrawer()
  }

  private replaceDrawer(): void {
    const wasOpen = this.#drawerOpen
    if (this.#drawer) {
      this.#overlay.remove(this.#drawer)
    }
    this.#drawer = createDrawer(this.#drawerButtons, 0)
    if (this.#drawer) {
      this.#overlay.add(this.#drawer)
      for (const [key, active] of this.#drawerStates.entries()) {
        const behavior = this.#drawer.behavior as DrawerBehavior | undefined
        behavior?.setButtonState?.(this.#drawer, key, active)
      }
      const behavior = this.#drawer.behavior as DrawerBehavior | undefined
      if (behavior?.setOpen && wasOpen) {
        this.#drawerOpen = true
        behavior.setOpen(this.#drawer, true)
      } else if (!wasOpen) {
        this.#drawerOpen = false
      }
    }
  }

  private attachBehavior(): void {
    const app = this.#application as unknown as { behavior?: Record<string, unknown> }
    if (!app.behavior) {
      app.behavior = new (class extends Behavior {})() as unknown as Record<string, unknown>
    }
    app.behavior.setFace = (face: PiuContainer) => this.setFace(face)
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
