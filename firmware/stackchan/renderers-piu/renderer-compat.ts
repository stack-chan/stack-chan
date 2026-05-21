import type { AppController } from 'app-controller'
import type { FaceContext } from 'face-context'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'

type RendererCompatOptions = {
  controller: AppController
}

let warned = false

function warnDeprecation() {
  if (warned) return
  warned = true
  trace('[DEPRECATED] RendererCompat is a temporary adapter. Use AppController/FaceView APIs directly.\n')
}

// Compatibility layer for legacy Renderer API. Mods compatibility is not fully verified yet.
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
    this.#controller.setFace(face)
  }
}

export type Effect = PiuContent
export type LegacyDecorator = PiuContent
