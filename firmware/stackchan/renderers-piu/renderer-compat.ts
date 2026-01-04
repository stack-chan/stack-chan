import type { Content as PiuContent } from 'piu/MC'
import type { FaceContext } from 'face-context'
import type { Effect } from 'main-view'
import type { Container as PiuContainer } from 'piu/MC'
import type { AppController } from 'app-controller'

type RendererCompatOptions = {
  controller: AppController
}

let warned = false

function warnDeprecation() {
  if (warned) return
  warned = true
  trace('[DEPRECATED] RendererCompat is a temporary adapter. Use Face/Shell APIs directly.\n')
}

export class RendererCompat {
  #controller: AppController

  constructor(options: RendererCompatOptions) {
    warnDeprecation()
    this.#controller = options.controller
  }

  get application() {
    return this.#controller.application
  }

  update(interval: number, faceContext: Readonly<FaceContext>): void {
    this.#controller.update(interval, faceContext)
  }

  addDecorator(effect: Effect): void {
    warnDeprecation()
    this.#controller.addEffect(effect)
  }

  removeDecorator(effect: Effect): void {
    warnDeprecation()
    this.#controller.removeEffect(effect)
  }

  setFace(face: PiuContainer): void {
    const app = this.#controller.application as unknown as {
      shellController?: { setFace?: (next: PiuContainer) => void }
    }
    app.shellController?.setFace?.(face)
  }
}

export type LegacyDecorator = PiuContent
