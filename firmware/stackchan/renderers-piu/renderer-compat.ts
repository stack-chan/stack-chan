import type { Content as PiuContent } from 'piu/MC'
import type { FaceContext } from 'face-context'
import type { Effect } from 'main-view'
import type { Main } from 'main-view'

type RendererCompatOptions = {
  main: Main
}

let warned = false

function warnDeprecation() {
  if (warned) return
  warned = true
  trace('[DEPRECATED] RendererCompat is a temporary adapter. Use Face/Shell APIs directly.\n')
}

export class RendererCompat {
  #main: Main

  constructor(options: RendererCompatOptions) {
    warnDeprecation()
    this.#main = options.main
  }

  get application() {
    return this.#main.application
  }

  update(interval: number, faceContext: Readonly<FaceContext>): void {
    this.#main.update(interval, faceContext)
  }

  addDecorator(effect: Effect): void {
    warnDeprecation()
    this.#main.addEffect(effect)
  }

  removeDecorator(effect: Effect): void {
    warnDeprecation()
    this.#main.removeEffect(effect)
  }
}

export type LegacyDecorator = PiuContent
