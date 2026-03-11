import type { Content as PiuContent } from 'piu/MC'
import type { FaceContext } from 'face-context'
import type { FaceEffect } from './renderer-base'
import { Face } from './renderer-base'

type RendererCompatOptions = {
  face: Face
}

let warned = false

function warnDeprecation() {
  if (warned) return
  warned = true
  trace('[DEPRECATED] RendererCompat is a temporary adapter. Use Face/Shell APIs directly.\n')
}

export class RendererCompat {
  #face: Face

  constructor(options: RendererCompatOptions) {
    warnDeprecation()
    this.#face = options.face
  }

  get application() {
    return this.#face.application
  }

  update(interval: number, faceContext: Readonly<FaceContext>): void {
    this.#face.update(interval, faceContext)
  }

  addDecorator(effect: FaceEffect): void {
    warnDeprecation()
    this.#face.addEffect(effect)
  }

  removeDecorator(effect: FaceEffect): void {
    warnDeprecation()
    this.#face.removeEffect(effect)
  }
}

export type LegacyDecorator = PiuContent
