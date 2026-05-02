import { Drawer, type DrawerBehavior, type DrawerButtonSpec } from 'drawer'
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
  drawerButtons?: DrawerButtonSpec[]
}

export type CommonViewTemplateCtor = TemplateFunction<CommonViewParams, PiuContainer>

export class CommonViewBehavior extends Behavior {
  container: PiuContainer | null = null
  main: PiuContainer | null = null
  appBar: PiuContent | null = null
  overlay: PiuContainer | null = null
  drawer: PiuContainer | null = null
  drawerOpen = false
  drawerButtons: DrawerButtonSpec[] = []
  drawerStates = new Map<string, boolean>()

  onCreate(container: PiuContainer, data: CommonViewParams) {
    this.container = container
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
    this.drawerButtons = data.drawerButtons ?? []
    this.drawer = new Drawer({ buttons: this.drawerButtons })
    if (this.drawer && this.container) this.container.add(this.drawer)
    this.setOverlayActive(false)
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
    const container = this.container
    if (!container) return
    const wasOpen = this.drawerOpen
    if (this.drawer) container.remove(this.drawer)
    this.drawer = new Drawer({ buttons: this.drawerButtons })
    if (this.drawer) {
      container.add(this.drawer)
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
    type OverlayContainer = PiuContainer & { active?: boolean; visible?: boolean; backgroundTouch?: boolean }
    const overlay = this.overlay as OverlayContainer
    overlay.active = active
    overlay.visible = true
    overlay.backgroundTouch = active
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
