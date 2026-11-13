import { toPiuColorString } from 'face-state'
import { Container, Content, Skin, Texture } from 'piu/MC'
import { BOOK_WIDTH, PAGE_HEIGHT } from 'reading-book-geometry'
import { PAGE_FRAME_COUNT } from 'reading-choreography'

let outerTexture
let innerTexture
export const PageTurn = Container.template(() => ({
  left: 0,
  top: 0,
  width: BOOK_WIDTH,
  height: PAGE_HEIGHT,
  active: false,
  contents: [
    new Content(null, { left: 0, top: 0, width: BOOK_WIDTH, height: PAGE_HEIGHT, active: false }),
    new Content(null, { left: 0, top: 0, width: BOOK_WIDTH, height: PAGE_HEIGHT, active: false }),
  ],
  Behavior: class extends Behavior {
    #primary = -1
    #secondary = -1
    onCreate(container) {
      outerTexture ??= new Texture('reading-page-outer.png')
      innerTexture ??= new Texture('reading-page-inner.png')
      this.onFaceSkin(container, { primaryColor: 0xffffff, secondaryColor: 0 })
    }
    onFaceSkin(container, palette) {
      if (palette.primaryColor === this.#primary && palette.secondaryColor === this.#secondary) return
      this.#primary = palette.primaryColor
      this.#secondary = palette.secondaryColor
      container.first.skin = new Skin({
        texture: outerTexture,
        color: toPiuColorString(this.#primary),
        x: 0,
        y: 0,
        width: BOOK_WIDTH,
        height: PAGE_HEIGHT,
        variants: BOOK_WIDTH,
      })
      container.last.skin = new Skin({
        texture: innerTexture,
        color: toPiuColorString(this.#secondary),
        x: 0,
        y: 0,
        width: BOOK_WIDTH,
        height: PAGE_HEIGHT,
        variants: BOOK_WIDTH,
      })
    }
    onPageVariant(container, variant) {
      if (!Number.isInteger(variant) || variant < 0 || variant > PAGE_FRAME_COUNT) return
      container.first.variant = container.last.variant = variant
    }
  },
}))
