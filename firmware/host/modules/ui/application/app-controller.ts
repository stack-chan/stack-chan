import type { AppBarMode } from 'chat-status-bar'
import type { DrawerActionEvent, DrawerButtonViewSpec } from 'drawer'
import type { FaceState } from 'face-state'
import {
  FaceMainTemplate,
  FaceView,
  type FaceViewBehavior,
  type FaceViewParams,
  type FaceViewTemplateCtor,
} from 'face-view'
import type { HandAnimationName } from 'hands'
import {
  MINI_APP_BAR_HEIGHT,
  type MiniAppCapabilities,
  type MiniAppContext,
  type MiniAppDefinition,
  type MiniAppInstance,
  MiniAppRegistry,
  type MiniAppRegistryCapability,
} from 'mini-app'
import { createMiniAppViewport, MiniAppLauncher } from 'mini-app-launcher'
import type {
  ApplicationDictionary,
  Application as PiuApplication,
  Container as PiuContainer,
  Content as PiuContent,
} from 'piu/MC'
import { Application, Container } from 'piu/MC'
import { type ScreenChangeListener, ScreenCoordinator, ScreenKind } from 'screen-coordinator'

export type MiniAppCapabilityGrant = (
  definition: MiniAppDefinition,
  trackResource: (cleanup: () => void) => void,
) => MiniAppCapabilities | undefined

export type AppControllerParams = FaceViewParams & {
  grantMiniAppCapabilities?: MiniAppCapabilityGrant
}

type GlobalWithApplication = typeof globalThis & {
  application?: PiuApplication
}

type ActiveMiniApp = {
  definition: MiniAppDefinition
  content: PiuContainer
  dispose?: () => void
  revokeResources: () => void
  sessionId: number
}

type MiniAppContentBehavior = {
  onDispose?: (content: PiuContainer) => void
}

type AppBarBehavior = {
  onAppBarMode?: (content: PiuContent, mode: AppBarMode) => void
  onMiniAppAvailability?: (content: PiuContent, available: boolean) => void
}

function unwrapMiniAppInstance(created: PiuContainer | MiniAppInstance): MiniAppInstance {
  if (created instanceof Container) return { content: created }
  if (created && created.content instanceof Container) return created
  throw new TypeError('mini app create must return a Piu Container or MiniAppInstance')
}

export class AppController extends Behavior {
  #application: PiuApplication | null = null
  #activeMiniApp: ActiveMiniApp | null = null
  #drawerActions = new Map<string, (value?: string) => void>()
  #grantMiniAppCapabilities: MiniAppCapabilityGrant | undefined
  #miniAppRegistry = new MiniAppRegistry()
  #screens = new ScreenCoordinator()
  #view: PiuContainer | null = null
  #viewBehavior: FaceViewBehavior | null = null

  onCreate(application: PiuApplication, data: AppControllerParams) {
    this.#application = application
    this.#grantMiniAppCapabilities = data.grantMiniAppCapabilities
    const main = data.main ?? new FaceMainTemplate(data, { anchor: 'MAIN' })
    const viewData: FaceViewParams = { ...data, main }
    this.showView(FaceView, viewData)
    this.#miniAppRegistry.subscribe(() => this.#onMiniAppRegistryChanged())
    this.#setAppBarMode({ kind: 'face' })
    this.#syncMiniAppAvailability()
  }

  get application(): PiuApplication {
    return this.#application as PiuApplication
  }

  get miniApps(): MiniAppRegistryCapability {
    return this.#miniAppRegistry
  }

  get isFaceForeground(): boolean {
    return this.#screens.isFaceForeground
  }

  subscribeScreenChange(listener: ScreenChangeListener): () => void {
    return this.#screens.subscribe(listener)
  }

  showView(ViewTemplate: FaceViewTemplateCtor, data: FaceViewParams) {
    const app = this.#application
    if (!app) return
    const view = new ViewTemplate(data)
    app.empty()
    app.add(view)
    this.#view = view
    this.#viewBehavior = view.behavior as FaceViewBehavior
  }

  update(_interval: number, faceState: FaceState): void {
    if (!this.#view || !this.#viewBehavior) return
    this.#viewBehavior.onFaceUpdate?.(this.#view, faceState)
  }

  addEffect(effect: PiuContent, key?: string): void {
    this.#viewBehavior?.addEffect?.(effect, key)
  }

  removeEffect(effect: PiuContent): void {
    this.#viewBehavior?.removeEffect?.(effect)
  }

  removeEffectByKey(key: string): void {
    this.#viewBehavior?.removeEffectByKey?.(key)
  }

  setFace(face: PiuContainer): void {
    this.#viewBehavior?.setFace?.(face)
  }

  setHandAnimation(animation: HandAnimationName): void {
    this.#viewBehavior?.setHandAnimation?.(animation)
  }

  setFaceMotionEnabled(enabled: boolean): void {
    this.#viewBehavior?.setFaceMotionEnabled?.(enabled)
  }

  setMain(content: PiuContainer): void {
    if (this.#activeMiniApp) {
      const active = this.#activeMiniApp
      this.#activeMiniApp = null
      this.#disposeMiniAppContent(active.content, active.dispose, active.revokeResources)
    }
    this.#viewBehavior?.setMain?.(content)
    if (content === this.#viewBehavior?.faceMain) {
      this.#screens.returnToFace()
    } else {
      this.#screens.enterSystemView()
    }
  }

  showFace(): void {
    if (this.#activeMiniApp) {
      this.exitMiniApp()
      return
    }
    this.#viewBehavior?.showFace?.()
    this.#setAppBarMode({ kind: 'face' })
    this.#screens.returnToFace()
  }

  showMiniAppLauncher(): void {
    if (this.#miniAppRegistry.list().length === 0) return
    if (this.#activeMiniApp) this.exitMiniApp()
    this.closeDrawer()
    this.#renderMiniAppLauncher()
  }

  launchMiniApp(id: string): boolean {
    const definition = this.#miniAppRegistry.get(id)
    const app = this.#application
    if (!definition || !app || !this.#viewBehavior) return false

    if (this.#activeMiniApp) this.exitMiniApp()
    let activeSessionId = 0
    let closeRequested = false
    let resourcesRevoked = false
    const cleanups: Array<() => void> = []
    const trackResource = (cleanup: () => void) => {
      if (typeof cleanup !== 'function') return
      if (resourcesRevoked) {
        try {
          cleanup()
        } catch (error) {
          trace(`[MiniApp] late resource cleanup failed error=${String(error)}\n`)
        }
        return
      }
      cleanups.push(cleanup)
    }
    const revokeResources = () => {
      if (resourcesRevoked) return
      resourcesRevoked = true
      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        try {
          cleanups[index]()
        } catch (error) {
          trace(`[MiniApp] resource cleanup failed error=${String(error)}\n`)
        }
      }
      cleanups.length = 0
    }

    let instance: MiniAppInstance | null = null
    let dispose: (() => void) | undefined
    try {
      const capabilities =
        definition.permissions && definition.permissions.length > 0
          ? this.#grantMiniAppCapabilities?.(definition, trackResource)
          : undefined
      const context: MiniAppContext = Object.freeze({
        width: app.width || 320,
        height: Math.max(0, (app.height || 240) - MINI_APP_BAR_HEIGHT),
        ...(capabilities ? { capabilities: Object.freeze(capabilities) } : {}),
        trackResource,
        close: () => {
          if (activeSessionId !== 0 && this.#activeMiniApp?.sessionId === activeSessionId) {
            this.exitMiniApp()
          } else {
            closeRequested = true
          }
        },
      })
      instance = unwrapMiniAppInstance(definition.create(context))
      dispose = instance.dispose?.bind(instance)
      if (closeRequested) {
        this.#disposeMiniAppContent(instance.content, dispose, revokeResources)
        this.showFace()
        return true
      }
      const viewport = createMiniAppViewport(instance.content)
      const sessionId = this.#screens.enterMiniApp(definition.id, definition.title)
      activeSessionId = sessionId
      this.#activeMiniApp = {
        definition,
        content: instance.content,
        dispose,
        revokeResources,
        sessionId,
      }
      this.#setAppBarMode({ kind: 'app', title: definition.title })
      this.#viewBehavior.setMain(viewport)
      return true
    } catch (error) {
      trace(`[MiniApp] launch failed id=${id} error=${String(error)}\n`)
      this.#disposeMiniAppContent(instance?.content ?? null, dispose, revokeResources)
      this.#activeMiniApp = null
      this.#renderMiniAppLauncher()
      return false
    }
  }

  exitMiniApp(): void {
    if (!this.#activeMiniApp) return
    const active = this.#activeMiniApp
    this.#activeMiniApp = null
    this.#viewBehavior?.showFace?.()
    this.#setAppBarMode({ kind: 'face' })
    this.#screens.exitMiniApp(active.sessionId)
    this.#disposeMiniAppContent(active.content, active.dispose, active.revokeResources)
  }

  setDrawerButtons(buttons: DrawerButtonViewSpec[]): void {
    this.#viewBehavior?.setDrawerButtons?.(buttons)
  }

  addDrawerButton(button: DrawerButtonViewSpec): void {
    this.#viewBehavior?.addDrawerButton?.(button)
  }

  removeDrawerButton(key: string): void {
    this.#viewBehavior?.removeDrawerButton?.(key)
  }

  setDrawerButtonState(key: string, active: boolean): void {
    this.#viewBehavior?.setDrawerButtonState?.(key, active)
  }

  openDrawer(): void {
    this.#viewBehavior?.openDrawer?.()
  }

  closeDrawer(): void {
    this.#viewBehavior?.closeDrawer?.()
  }

  toggleDrawer(): void {
    this.#viewBehavior?.toggleDrawer?.()
  }

  bindDrawerAction(key: string, callback: (value?: string) => void): boolean {
    const target = this as unknown as Record<string, unknown>
    const ownsKey = this.#drawerActions.has(key)
    if (!ownsKey && typeof target[key] === 'function') {
      trace(`[AppController] drawer action key collision: ${key}\n`)
      return false
    }
    this.#drawerActions.set(key, callback)
    return true
  }

  unbindDrawerAction(key: string): void {
    this.#drawerActions.delete(key)
  }

  onDrawerAction(_application: PiuApplication, action: DrawerActionEvent | string, value?: string): boolean {
    const key = typeof action === 'string' ? action : action?.key
    const resolvedValue = typeof action === 'string' ? value : action?.value
    if (!key) return false
    const callback = this.#drawerActions.get(key)
    if (!callback) return false
    callback(resolvedValue)
    return true
  }

  onDrawerToggle(): void {
    trace('[AppController] onDrawerToggle\n')
    this.toggleDrawer()
  }

  onDrawerOpen(): void {
    trace('[AppController] onDrawerOpen\n')
    this.openDrawer()
  }

  onDrawerClose(): void {
    trace('[AppController] onDrawerClose\n')
    this.closeDrawer()
    this.#application?.distribute('onAppBarReveal')
  }

  onFaceTouch(): void {
    trace('[AppController] onFaceTouch\n')
    this.#application?.distribute('onAppBarReveal')
  }

  onMiniAppLauncher(): void {
    this.showMiniAppLauncher()
  }

  onMiniAppBack(): void {
    const kind = this.#screens.kind
    if (kind === ScreenKind.MiniAppRunning) {
      this.exitMiniApp()
      return
    }
    if (kind === ScreenKind.MiniAppLauncher || kind === ScreenKind.SystemView) {
      this.showFace()
    }
  }

  #renderMiniAppLauncher(): void {
    const launcher = new MiniAppLauncher({
      apps: this.#miniAppRegistry.list(),
      onLaunch: (id) => this.launchMiniApp(id),
    })
    this.#screens.openMiniAppLauncher('ミニアプリ')
    this.#viewBehavior?.setMain(createMiniAppViewport(launcher))
    this.#setAppBarMode({ kind: 'launcher', title: 'ミニアプリ' })
  }

  #onMiniAppRegistryChanged(): void {
    this.#syncMiniAppAvailability()
    if (this.#activeMiniApp && !this.#miniAppRegistry.get(this.#activeMiniApp.definition.id)) {
      this.exitMiniApp()
      return
    }
    if (this.#screens.kind === ScreenKind.MiniAppLauncher) {
      if (this.#miniAppRegistry.list().length === 0) this.showFace()
      else this.#renderMiniAppLauncher()
    }
  }

  #syncMiniAppAvailability(): void {
    const appBar = this.#viewBehavior?.appBar
    if (!appBar) return
    const behavior = appBar.behavior as AppBarBehavior | undefined
    behavior?.onMiniAppAvailability?.(appBar, this.#miniAppRegistry.list().length > 0)
  }

  #setAppBarMode(mode: AppBarMode): void {
    const appBar = this.#viewBehavior?.appBar
    if (!appBar) return
    const behavior = appBar.behavior as AppBarBehavior | undefined
    behavior?.onAppBarMode?.(appBar, mode)
  }

  #disposeMiniAppContent(content: PiuContainer | null, dispose?: () => void, revokeResources?: () => void): void {
    if (content) {
      try {
        ;(content.behavior as MiniAppContentBehavior | undefined)?.onDispose?.(content)
      } catch (error) {
        trace(`[MiniApp] onDispose failed error=${String(error)}\n`)
      }
    }
    try {
      dispose?.()
    } catch (error) {
      trace(`[MiniApp] dispose failed error=${String(error)}\n`)
    }
    revokeResources?.()
  }
}

export function createAppControllerApplication(
  data: AppControllerParams,
  dictionary: Omit<ApplicationDictionary, 'Behavior' | 'contents'> = {},
): AppController {
  const existingApplication = (globalThis as GlobalWithApplication).application
  if (existingApplication) {
    const controller = new AppController()
    existingApplication.empty()
    existingApplication.behavior = controller
    controller.onCreate(existingApplication, data)
    return controller
  }

  const application = new Application(data, {
    ...dictionary,
    contents: [],
    Behavior: AppController,
  })
  return application.behavior as AppController
}
