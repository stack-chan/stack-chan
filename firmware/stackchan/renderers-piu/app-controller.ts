import type { Application as PiuApplication, Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { DrawerButtonSpec } from 'drawer'
import type { FaceContext } from 'face-context'
import {
  FaceMainTemplate,
  FaceView,
  type FaceViewBehavior,
  type FaceViewParams,
  type FaceViewTemplateCtor,
} from 'face-view'
import type { FaceContainerParams, FaceTemplateCtor } from 'behaviors/face'

export type AppControllerParams = FaceViewParams

type DrawerControllerHost = {
  drawerController?: {
    setButtons?: (buttons: DrawerButtonSpec[]) => void
    addButton?: (button: DrawerButtonSpec) => void
    removeButton?: (key: string) => void
    setButtonState?: (key: string, active: boolean) => void
  }
  shellController?: {
    setFace?: (face: PiuContainer) => void
  }
}

export class AppController extends Behavior {
  #application: PiuApplication | null = null
  #view: PiuContainer | null = null
  #viewBehavior: FaceViewBehavior | null = null

  onCreate(application: PiuApplication, data: AppControllerParams) {
    this.#application = application
    const viewData: FaceViewParams = { ...data, mainTemplate: FaceMainTemplate, mainParams: data }
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

  addEffect(effect: PiuContent): void {
    this.#viewBehavior?.addEffect?.(effect)
  }

  removeEffect(effect: PiuContent): void {
    this.#viewBehavior?.removeEffect?.(effect)
  }

  setFaceContainer(face: PiuContainer): void {
    this.#viewBehavior?.setFaceContainer?.(face)
  }

  setFaceTemplate(template: FaceTemplateCtor, params?: FaceContainerParams): void {
    this.#viewBehavior?.setFaceTemplate?.(template, params)
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

  private attachControllers(): void {
    if (!this.#application) return
    const host = this.#application as unknown as DrawerControllerHost
    host.drawerController = {
      setButtons: (buttons) => this.setDrawerButtons(buttons),
      addButton: (button) => this.addDrawerButton(button),
      removeButton: (key) => this.removeDrawerButton(key),
      setButtonState: (key, active) => this.setDrawerButtonState(key, active),
    }
    host.shellController = {
      setFace: (face) => this.setFaceContainer(face),
    }
  }
}
