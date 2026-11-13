import { Outline } from 'commodetto/outline'
import { createFaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, DEFAULT_FACE_SECONDARY_COLOR } from 'face-state'
import { Container } from 'piu/MC'
import { PageTurn } from 'reading-page-effect'
import 'piu/shape'
import { BOOK_HEIGHT, BOOK_PATHS, BOOK_WIDTH, PAGE_RISE } from 'reading-book-geometry'

let assets
function getAssets() {
  if (assets) return assets
  assets = BOOK_PATHS.map(({ commands, fill }) => {
    const path = new Outline.CanvasPath()
    for (const [method, ...args] of commands) path[method](...args)
    return { fill: fill ? Outline.fill(path) : undefined, stroke: Outline.stroke(path, 4) }
  })
  return assets
}

const BookPart = Shape.template((asset) => ({
  left: 0,
  top: PAGE_RISE,
  width: BOOK_WIDTH,
  height: BOOK_HEIGHT,
  active: false,
  Behavior: class extends Behavior {
    onCreate(shape) {
      const palette = createFaceSkinPalette(DEFAULT_FACE_PRIMARY_COLOR, DEFAULT_FACE_SECONDARY_COLOR)
      shape.skin = palette.mixed
      shape.fillOutline = asset.fill
      shape.strokeOutline = asset.stroke
    }
    onFaceSkin(shape, palette) {
      shape.skin = palette.mixed
    }
  },
}))

export const ReadingBook = Container.template(() => ({
  width: BOOK_WIDTH,
  // Keep the raised page inside the effect's bounds so removal and theme
  // changes invalidate it as well. The approved cover remains bottom-aligned.
  height: BOOK_HEIGHT + PAGE_RISE,
  bottom: 0,
  active: false,
  contents: [
    // The viewer faces the reader: cover and spine occlude the turning leaf.
    new PageTurn(),
    ...getAssets().map((asset) => new BookPart(asset)),
  ],
  Behavior: class extends Behavior {
    onDisplaying(container) {
      trace(`[reading] book displayed: ${container.width}x${container.height}, parts=${container.length}\n`)
    }
    onPageVariant(container, variant) {
      const page = container.first
      page.behavior.onPageVariant(page, variant)
    }
    onFaceSkin(container, palette) {
      // addEffect applies the current palette to the root before future broadcasts.
      // Podcast keeps the face detached while adding this effect. Piu delegate
      // requires an Application, but palette updates must also work offscreen.
      for (let part = container.first; part; part = part.next) part.behavior?.onFaceSkin?.(part, palette)
    }
  },
}))
