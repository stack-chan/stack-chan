import { Application } from 'piu/MC'
import type {
  Application as PiuApplication,
  ApplicationDictionary,
  Container as PiuContainer,
  Content as PiuContent,
} from 'piu/MC'
import type { DrawerButtonSpec } from 'drawer'
import type { FaceContext } from 'face-context'
import {
  FaceMainTemplate,
  FaceView,
  type FaceViewBehavior,
  type FaceViewParams,
  type FaceViewTemplateCtor,
} from 'face-view'

export type AppControllerParams = FaceViewParams

type DrawerControllerHost = {
  drawerController?: {
    setButtons?: (buttons: DrawerButtonSpec[]) => void
    addButton?: (button: DrawerButtonSpec) => void
    removeButton?: (key: string) => void
    setButtonState?: (key: string, active: boolean) => void
  }
}

type GlobalWithApplication = typeof globalThis & {
  application?: PiuApplication
}

export class AppController extends Behavior {
  #application: PiuApplication | null = null
  #view: PiuContainer | null = null
  #viewBehavior: FaceViewBehavior | null = null

  onCreate(application: PiuApplication, data: AppControllerParams) {
    this.#application = application
    const main = data.main ?? new FaceMainTemplate(data, { anchor: 'MAIN' })
    const viewData: FaceViewParams = { ...data, main }
    this.showView(FaceView, viewData)
    this.attachControllers()
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

  update(_interval: number, faceContext: Readonly<FaceContext>): void {
    if (!this.#view || !this.#viewBehavior) return
    this.#viewBehavior.onFaceUpdate?.(this.#view, faceContext)
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

  private attachControllers(): void {
    if (!this.#application) return
    const host = this.#application as DrawerControllerHost
    host.drawerController = {
      setButtons: (buttons) => this.setDrawerButtons(buttons),
      addButton: (button) => this.addDrawerButton(button),
      removeButton: (key) => this.removeDrawerButton(key),
      setButtonState: (key, active) => this.setDrawerButtonState(key, active),
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
