import type { DrawerButtonSpec } from 'drawer'
import type { FaceState } from 'face-state'
import {
  FaceMainTemplate,
  FaceView,
  type FaceViewBehavior,
  type FaceViewParams,
  type FaceViewTemplateCtor,
} from 'face-view'
import type {
  ApplicationDictionary,
  Application as PiuApplication,
  Container as PiuContainer,
  Content as PiuContent,
} from 'piu/MC'
import { Application } from 'piu/MC'

export type AppControllerParams = FaceViewParams

type GlobalWithApplication = typeof globalThis & {
  application?: PiuApplication
}

export class AppController extends Behavior {
  #application: PiuApplication | null = null
  #drawerActionKeys = new Set<string>()
  #view: PiuContainer | null = null
  #viewBehavior: FaceViewBehavior | null = null

  onCreate(application: PiuApplication, data: AppControllerParams) {
    this.#application = application
    const main = data.main ?? new FaceMainTemplate(data, { anchor: 'MAIN' })
    const viewData: FaceViewParams = { ...data, main }
    this.showView(FaceView, viewData)
  }

  get application(): PiuApplication {
    return this.#application as PiuApplication
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

  setDrawerButtons(buttons: DrawerButtonSpec[]): void {
    this.#viewBehavior?.setDrawerButtons?.(buttons)
  }

  addDrawerButton(button: DrawerButtonSpec): void {
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

  bindDrawerAction(key: string, callback: () => void): boolean {
    const target = this as unknown as Record<string, unknown>
    const ownsKey = this.#drawerActionKeys.has(key)
    if (!ownsKey && typeof target[key] === 'function') {
      trace(`[AppController] drawer action key collision: ${key}\n`)
      return false
    }
    target[key] = callback
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
  }

  onFaceTouch(): void {
    trace('[AppController] onFaceTouch\n')
    this.onDrawerToggle()
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
