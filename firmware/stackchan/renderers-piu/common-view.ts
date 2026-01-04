import { Container, type Container as PiuContainer, type Content as PiuContent } from 'piu/MC'
import { createDrawer, type DrawerBehavior, type DrawerButtonSpec } from 'drawer'

export type CommonViewParams = {
  mainTemplate?: { new (behaviorData?: unknown, dictionary?: unknown): PiuContainer }
  mainParams?: unknown
  appBarTemplate?: { new (behaviorData?: unknown, dictionary?: unknown): PiuContent }
  appBarParams?: unknown
  drawerButtons?: DrawerButtonSpec[]
  drawerTopOffset?: number
}

export type CommonViewTemplateCtor = {
  new (behaviorData?: unknown, dictionary?: CommonViewParams): PiuContainer
  template?: (factory: unknown) => unknown
}

export class CommonViewBehavior extends Behavior {
  main: PiuContainer | null = null
  appBar: PiuContent | null = null
  overlay: PiuContainer | null = null
  drawer: PiuContainer | null = null
  drawerOpen = false
  drawerButtons: DrawerButtonSpec[] = []
  drawerStates = new Map<string, boolean>()
  drawerTopOffset = 0

  onCreate(container: PiuContainer, data: CommonViewParams) {
    this.main = container.first as PiuContainer | null
    this.appBar = this.main?.next as PiuContent | null
    this.overlay = (this.appBar?.next as PiuContainer | null) ?? null
    this.drawerButtons = data.drawerButtons ?? []
    this.drawerTopOffset = data.drawerTopOffset ?? 0
    if (this.overlay) {
      this.drawer = createDrawer(this.drawerButtons, this.drawerTopOffset)
      if (this.drawer) this.overlay.add(this.drawer)
      this.setOverlayActive(false)
    }
  }

  onOverlayTouch(_container: PiuContainer) {
    trace(`[CommonView] onOverlayTouch drawerOpen=${this.drawerOpen}\n`)
    if (this.drawerOpen) this.closeDrawer()
    else this.openDrawer()
  }

  openDrawer(): void {
    if (!this.drawer || this.drawerOpen) return
    trace('[CommonView] openDrawer\n')
    const behavior = this.drawer.behavior as DrawerBehavior | undefined
    if (!behavior?.setOpen) return
    this.drawerOpen = true
    this.setOverlayActive(true)
    behavior.setOpen(this.drawer, true)
  }

  closeDrawer(): void {
    if (!this.drawer || !this.drawerOpen) return
    trace('[CommonView] closeDrawer\n')
    const behavior = this.drawer.behavior as DrawerBehavior | undefined
    if (!behavior?.setOpen) return
    this.drawerOpen = false
    behavior.setOpen(this.drawer, false)
    this.setOverlayActive(false)
  }

  toggleDrawer(): void {
    if (this.drawerOpen) this.closeDrawer()
    else this.openDrawer()
  }

  setDrawerButtons(buttons: DrawerButtonSpec[]): void {
    this.drawerButtons = [...buttons]
    this.replaceDrawer()
  }

  addDrawerButton(button: DrawerButtonSpec): void {
    const index = this.drawerButtons.findIndex((item) => item.key === button.key)
    if (index >= 0) this.drawerButtons[index] = button
    else this.drawerButtons.push(button)
    this.replaceDrawer()
  }

  removeDrawerButton(key: string): void {
    const next = this.drawerButtons.filter((item) => item.key !== key)
    if (next.length === this.drawerButtons.length) return
    this.drawerButtons = next
    this.replaceDrawer()
  }

  setDrawerButtonState(key: string, active: boolean): void {
    this.drawerStates.set(key, active)
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    const updated = behavior?.setButtonState?.(drawer as PiuContainer, key, active)
    const index = this.drawerButtons.findIndex((item) => item.key === key)
    if (index >= 0) this.drawerButtons[index] = { ...this.drawerButtons[index], active }
    if (!updated) this.replaceDrawer()
  }

  private replaceDrawer(): void {
    const overlay = this.overlay
    if (!overlay) return
    const wasOpen = this.drawerOpen
    if (this.drawer) overlay.remove(this.drawer)
    this.drawer = createDrawer(this.drawerButtons, this.drawerTopOffset)
    if (this.drawer) {
      overlay.add(this.drawer)
      for (const [key, active] of this.drawerStates.entries()) {
        const behavior = this.drawer.behavior as DrawerBehavior | undefined
        behavior?.setButtonState?.(this.drawer, key, active)
      }
      const behavior = this.drawer.behavior as DrawerBehavior | undefined
      if (behavior?.setOpen && wasOpen) {
        this.drawerOpen = true
        behavior.setOpen(this.drawer, true)
        this.setOverlayActive(true)
      } else {
        this.drawerOpen = false
        this.setOverlayActive(false)
      }
    }
  }

  private setOverlayActive(active: boolean) {
    if (!this.overlay) return
    const overlay = this.overlay as unknown as { active?: boolean; visible?: boolean; backgroundTouch?: boolean }
    overlay.active = active
    overlay.visible = true
    overlay.backgroundTouch = active
  }
}

export const CommonView = Container.template(($) => {
  const main = $.mainTemplate ? new $.mainTemplate($.mainParams ?? $) : new Container(null, {})
  const appBar = $.appBarTemplate
    ? new $.appBarTemplate($.appBarParams ?? $)
    : new Container(null, { left: 0, right: 0, top: 0, height: 0, active: false })
  const overlay = new Container($, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    active: false,
    clip: false,
    backgroundTouch: true,
    Behavior: class extends Behavior {
      onTouchBegan(_container: PiuContainer, _id: number, x: number, y: number) {
        trace(`[CommonView] overlay touch began x=${x} y=${y}\n`)
      }
      onTouchMoved(_container: PiuContainer, _id: number, x: number, y: number) {
        trace(`[CommonView] overlay touch moved x=${x} y=${y}\n`)
      }
      onTouchEnded(container: PiuContainer, _id: number, x: number, y: number) {
        trace(`[CommonView] overlay touch ended x=${x} y=${y}\n`)
        container.bubble('onOverlayTouch')
      }
    },
  })
  return {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    contents: [main, appBar, overlay],
    Behavior: CommonViewBehavior,
  }
}) as unknown as CommonViewTemplateCtor
