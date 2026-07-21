import { Drawer, type DrawerBehavior, type DrawerButtonViewSpec } from 'drawer'
import type {
  Container as PiuContainer,
  ContainerDictionary as PiuContainerDictionary,
  Content as PiuContent,
} from 'piu/MC'

export type TemplateFunction<TData, TResult> = {
  new (data?: TData, dictionary?: PiuContainerDictionary): TResult
  template?<TNextData>(factory: (arg: TNextData) => PiuContainerDictionary): TemplateFunction<TNextData, TResult>
}

type CommonViewAnchors = {
  MAIN?: PiuContainer
  APP_BAR?: PiuContent
  OVERLAY?: PiuContainer
}

export type CommonViewParams = CommonViewAnchors & {
  main?: PiuContainer
  appBar?: PiuContent
  drawerButtons?: DrawerButtonViewSpec[]
}

/**
 * Optional, Face-independent lifecycle hooks a swappable main content may implement.
 * None of these touch FaceState/skin, so any PiuContainer qualifies as MainContent.
 */
export type MainContentBehavior = {
  onShow?: (content: PiuContainer) => void
  onHide?: (content: PiuContainer) => void
  onDispose?: (content: PiuContainer) => void
}

/** A swappable main-area component: any PiuContainer with optional lifecycle hooks. */
export type MainContent = PiuContainer & { behavior?: MainContentBehavior }

export type CommonViewTemplateCtor = TemplateFunction<CommonViewParams, PiuContainer>

export class CommonViewBehavior extends Behavior {
  container: PiuContainer | null = null
  main: PiuContainer | null = null
  appBar: PiuContent | null = null
  overlay: PiuContainer | null = null
  drawer: PiuContainer | null = null
  drawerOpen = false
  drawerButtons: DrawerButtonViewSpec[] = []
  drawerStates: Map<string, boolean> | null = null

  onCreate(container: PiuContainer, data: CommonViewParams) {
    this.container = container
    this.drawerStates = new Map()
    const missing: string[] = []
    if (!data.MAIN) missing.push('MAIN')
    if (!data.APP_BAR) missing.push('APP_BAR')
    if (!data.OVERLAY) missing.push('OVERLAY')
    if (missing.length > 0) {
      throw new Error(`[CommonView] missing anchors: ${missing.join(', ')}`)
    }
    this.main = data.MAIN as PiuContainer
    this.appBar = data.APP_BAR as PiuContent
    this.overlay = data.OVERLAY as PiuContainer
    this.drawerButtons = [...(data.drawerButtons ?? [])]
    this.drawer = new Drawer({ buttons: this.drawerButtons })
    if (this.drawer && this.container) this.container.add(this.drawer)
    this.setOverlayActive(false)
  }

  /**
   * Replace the swappable MAIN component while keeping AppBar/Overlay/Drawer intact.
   * The new content is inserted below the AppBar so the main area stays the bottom layer.
   */
  setMain(content: MainContent): void {
    if (!this.container || this.main === content) return
    const previous = this.main
    if (previous) {
      this.container.remove(previous)
      ;(previous.behavior as MainContentBehavior | undefined)?.onHide?.(previous)
    }
    this.main = content
    // Insert before the AppBar (always present via zero-height fallback) to preserve z-order.
    const anchor = this.appBar ?? this.overlay
    if (anchor) this.container.insert(content, anchor)
    else this.container.add(content)
    ;(content.behavior as MainContentBehavior | undefined)?.onShow?.(content)
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

  setDrawerButtons(buttons: DrawerButtonViewSpec[]): void {
    this.drawerButtons = buttons.map((button) => this.withStoredDrawerState(button))
    this.syncDrawerButtons()
  }

  addDrawerButton(button: DrawerButtonViewSpec): void {
    const nextButton = this.withStoredDrawerState(button)
    const index = this.drawerButtons.findIndex((item) => item.key === button.key)
    if (index >= 0) this.drawerButtons[index] = nextButton
    else this.drawerButtons.push(nextButton)
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (drawer && behavior?.addButton?.(drawer, nextButton)) return
    this.syncDrawerButtons()
  }

  removeDrawerButton(key: string): void {
    const index = this.drawerButtons.findIndex((item) => item.key === key)
    if (index < 0) return
    this.drawerButtons.splice(index, 1)
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (drawer && behavior?.removeButton?.(drawer, key)) return
    this.syncDrawerButtons()
  }

  setDrawerButtonState(key: string, active: boolean): void {
    const states = this.getDrawerStates()
    states.set(key, active)
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    const updated = behavior?.setButtonState?.(drawer as PiuContainer, key, active)
    const index = this.drawerButtons.findIndex((item) => item.key === key)
    if (index >= 0) this.drawerButtons[index] = { ...this.drawerButtons[index], active }
    if (!updated && index >= 0) this.syncDrawerButtons()
  }

  private syncDrawerButtons(): void {
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (drawer && behavior?.setButtons?.(drawer, this.drawerButtons)) {
      this.applyStoredDrawerStates()
      return
    }
    this.replaceDrawer()
  }

  private replaceDrawer(): void {
    const container = this.container
    if (!container) return
    const wasOpen = this.drawerOpen
    if (this.drawer) container.remove(this.drawer)
    this.drawer = new Drawer({ buttons: this.drawerButtons })
    if (this.drawer) {
      container.add(this.drawer)
      this.applyStoredDrawerStates()
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
    type OverlayContainer = PiuContainer & { active?: boolean; visible?: boolean; backgroundTouch?: boolean }
    const overlay = this.overlay as OverlayContainer
    overlay.active = active
    overlay.visible = true
    overlay.backgroundTouch = active
  }

  private getDrawerStates(): Map<string, boolean> {
    if (!this.drawerStates) this.drawerStates = new Map()
    return this.drawerStates
  }

  private withStoredDrawerState(button: DrawerButtonViewSpec): DrawerButtonViewSpec {
    const active = this.getDrawerStates().get(button.key)
    return active === undefined ? button : { ...button, active }
  }

  private applyStoredDrawerStates(): void {
    const drawer = this.drawer
    const behavior = drawer?.behavior as DrawerBehavior | undefined
    if (!drawer || !behavior?.setButtonState) return
    for (const [key, active] of this.getDrawerStates().entries()) {
      behavior.setButtonState(drawer, key, active)
    }
  }
}

export const CommonView: CommonViewTemplateCtor = Container.template(($: CommonViewParams) => {
  const main = $.MAIN ?? $.main
  if (!main) {
    trace('[CommonView] ERROR: Missing main view instance\n')
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  if (!$.MAIN) {
    $.MAIN = main
  }
  const appBar =
    $.APP_BAR ??
    $.appBar ??
    new Content($, {
      anchor: 'APP_BAR',
      left: 0,
      right: 0,
      top: 0,
      height: 0,
    })
  if (!$.APP_BAR) {
    $.APP_BAR = appBar as PiuContent
  }
  const overlay = new Container($, {
    anchor: 'OVERLAY',
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
        container.bubble('onDrawerClose')
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
