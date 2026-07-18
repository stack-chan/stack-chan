import type { DrawerButtonViewSpec } from 'drawer'
import type { FaceState } from 'face-state'
import {
  FaceMainTemplate,
  FaceView,
  type FaceViewBehavior,
  type FaceViewParams,
  type FaceViewTemplateCtor,
} from 'face-view'
import type { AppBarMode } from 'chat-status-bar'
import {
  MINI_APP_BAR_HEIGHT,
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

export type AppControllerParams = FaceViewParams

type GlobalWithApplication = typeof globalThis & {
  application?: PiuApplication
}

type MiniAppScreen = 'face' | 'launcher' | 'app'

type ActiveMiniApp = {
  definition: MiniAppDefinition
  content: PiuContainer
  dispose?: () => void
  token: object
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
  #drawerActionKeys = new Set<string>()
  #miniAppRegistry = new MiniAppRegistry()
  #miniAppScreen: MiniAppScreen = 'face'
  #view: PiuContainer | null = null
  #viewBehavior: FaceViewBehavior | null = null

  onCreate(application: PiuApplication, data: AppControllerParams) {
    this.#application = application
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

  setFaceMotionEnabled(enabled: boolean): void {
    this.#viewBehavior?.setFaceMotionEnabled?.(enabled)
  }

  setMain(content: PiuContainer): void {
    this.#viewBehavior?.setMain?.(content)
  }

  showFace(): void {
    if (this.#activeMiniApp) {
      this.exitMiniApp()
      return
    }
    this.#miniAppScreen = 'face'
    this.#viewBehavior?.showFace?.()
    this.#setAppBarMode({ kind: 'face' })
  }

  showMiniAppLauncher(): void {
    if (this.#miniAppRegistry.list().length === 0) return
    if (this.#activeMiniApp) this.exitMiniApp()
    this.closeDrawer()
    this.#miniAppScreen = 'launcher'
    this.#renderMiniAppLauncher()
  }

  launchMiniApp(id: string): boolean {
    const definition = this.#miniAppRegistry.get(id)
    const app = this.#application
    if (!definition || !app || !this.#viewBehavior) return false

    if (this.#activeMiniApp) this.exitMiniApp()
    const token = {}
    let closeRequested = false
    const context: MiniAppContext = Object.freeze({
      width: app.width || 320,
      height: Math.max(0, (app.height || 240) - MINI_APP_BAR_HEIGHT),
      close: () => {
        if (this.#activeMiniApp?.token === token) this.exitMiniApp()
        else closeRequested = true
      },
    })

    let instance: MiniAppInstance | null = null
    try {
      instance = unwrapMiniAppInstance(definition.create(context))
      if (closeRequested) {
        this.#disposeMiniAppContent(instance.content, instance.dispose)
        this.showFace()
        return true
      }
      const viewport = createMiniAppViewport(instance.content)
      this.#activeMiniApp = {
        definition,
        content: instance.content,
        dispose: instance.dispose,
        token,
      }
      this.#miniAppScreen = 'app'
      this.#setAppBarMode({ kind: 'app', title: definition.title })
      this.#viewBehavior.setMain(viewport)
      return true
    } catch (error) {
      trace(`[MiniApp] launch failed id=${id} error=${String(error)}\n`)
      if (instance) this.#disposeMiniAppContent(instance.content, instance.dispose)
      this.#activeMiniApp = null
      this.#miniAppScreen = 'launcher'
      this.#renderMiniAppLauncher()
      return false
    }
  }

  exitMiniApp(): void {
    if (!this.#activeMiniApp) return
    const active = this.#activeMiniApp
    this.#activeMiniApp = null
    this.#miniAppScreen = 'face'
    this.#viewBehavior?.showFace?.()
    this.#setAppBarMode({ kind: 'face' })
    this.#disposeMiniAppContent(active.content, active.dispose)
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
    const ownsKey = this.#drawerActionKeys.has(key)
    if (!ownsKey && typeof target[key] === 'function') {
      trace(`[AppController] drawer action key collision: ${key}\n`)
      return false
    }
    target[key] = (_content: PiuContent, value?: string) => callback(value)
    this.#drawerActionKeys.add(key)
    return true
  }

  unbindDrawerAction(key: string): void {
    if (!this.#drawerActionKeys.has(key)) return
    delete (this as unknown as Record<string, unknown>)[key]
    this.#drawerActionKeys.delete(key)
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
    this.#application?.distribute('onMenuReveal')
  }

  onFaceTouch(): void {
    trace('[AppController] onFaceTouch\n')
    this.onDrawerToggle()
  }

  onMiniAppLauncher(): void {
    this.showMiniAppLauncher()
  }

  onMiniAppBack(): void {
    if (this.#miniAppScreen === 'app') this.exitMiniApp()
    else if (this.#miniAppScreen === 'launcher') this.showFace()
  }

  #renderMiniAppLauncher(): void {
    const launcher = new MiniAppLauncher({
      apps: this.#miniAppRegistry.list(),
      onLaunch: (id) => this.launchMiniApp(id),
    })
    this.#viewBehavior?.setMain(createMiniAppViewport(launcher))
    this.#setAppBarMode({ kind: 'launcher', title: 'ミニアプリ' })
  }

  #onMiniAppRegistryChanged(): void {
    this.#syncMiniAppAvailability()
    if (this.#activeMiniApp && !this.#miniAppRegistry.get(this.#activeMiniApp.definition.id)) {
      this.exitMiniApp()
      return
    }
    if (this.#miniAppScreen === 'launcher') {
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

  #disposeMiniAppContent(content: PiuContainer, dispose?: () => void): void {
    try {
      ;(content.behavior as MiniAppContentBehavior | undefined)?.onDispose?.(content)
    } catch (error) {
      trace(`[MiniApp] onDispose failed error=${String(error)}\n`)
    }
    try {
      dispose?.()
    } catch (error) {
      trace(`[MiniApp] dispose failed error=${String(error)}\n`)
    }
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
