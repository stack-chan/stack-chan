import { GuruguruAvatar } from 'guruguru-avatar'
import atlas from 'kasane-frames'
import { Image } from 'piu/Image'
import { Behavior, Container, Port, Texture } from 'piu/MC'

const prepareFrames = (source, opaque = false) =>
  source.map((frame) => ({
    ...frame,
    image: frame.texture.replace(/\.png$/, '.cs'),
    mouth: {
      ...frame.mouth,
      texture: opaque ? undefined : new Texture(frame.mouth.texture),
      image: frame.mouth.texture.replace(/\.png$/, '.cs'),
    },
    eyes: {
      ...frame.eyes,
      texture: opaque ? undefined : new Texture(frame.eyes.texture),
      image: frame.eyes.texture.replace(/\.png$/, '.cs'),
    },
  }))
const speaking = (model) => model.state === 'speak' && model.mouthOpen
const blinking = (model) => model.state !== 'speak' && !model.eyeOpen

const position = (port) => ({
  x: Math.round((port.width - atlas.width) / 2),
  y: Math.round((port.height - atlas.height) / 2),
})
const intersection = (a, b) => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  }
}
function drawRegion(port, texture, destination, dirty) {
  const region = intersection(destination, dirty)
  if (region.width && region.height)
    port.drawTexture(
      texture,
      'white',
      region.x,
      region.y,
      region.x - destination.x,
      region.y - destination.y,
      region.width,
      region.height,
    )
}

class AvatarBehavior extends Behavior {
  onCreate(_port, model) {
    this.model = model
  }
  onDisplaying() {
    this.model.resumeAnimation()
  }
  onUndisplaying() {
    this.model.pauseAnimation()
  }
  onTimeChanged() {
    this.model.animate()
  }
  onTouchBegan(port, id, x, y, ticks) {
    port.captureTouch(id, x, y, ticks)
    this.onTouchMoved(port, id, x, y)
  }
  onTouchMoved(port, _id, x, y) {
    this.model.trackFace(x - port.x, y - port.y, port.width, port.height)
  }
}

class FaceOverlayBehavior extends Behavior {
  onCreate(_port, { model, frameFor }) {
    this.model = model
    this.frameFor = frameFor
  }
  onDraw(port, x = 0, y = 0, width = port.width, height = port.height) {
    const frame = this.frameFor(this.model),
      offset = position(port)
    if (!frame.mouth.texture) return
    const dirty = { x, y, width, height }
    if (blinking(this.model))
      drawRegion(
        port,
        frame.eyes.texture,
        { ...frame.eyes, x: offset.x + frame.eyes.x, y: offset.y + frame.eyes.y },
        dirty,
      )
    if (speaking(this.model))
      drawRegion(
        port,
        frame.mouth.texture,
        { ...frame.mouth, x: offset.x + frame.mouth.x, y: offset.y + frame.mouth.y },
        dirty,
      )
  }
}

export function createGuruguruView() {
  const frameSets = { neutral: prepareFrames(atlas.frames) }
  const expressionFor = (model) => (atlas.expressions?.[model.expression] ? model.expression : 'neutral')
  const framesFor = (model) => {
    const expression = expressionFor(model)
    if (!frameSets[expression]) frameSets[expression] = prepareFrames(atlas.expressions[expression], true)
    return frameSets[expression]
  }
  const frameFor = (model) => framesFor(model)[model.direction] ?? framesFor(model)[4]
  let content,
    overlay,
    images,
    eyeImage,
    mouthImage,
    displayed = false,
    closed = false
  let lastExpression = 'neutral',
    lastDirection = 4,
    lastMouth = false,
    lastBlink = false
  const model = new GuruguruAvatar({
    invalidate() {
      if (!content || closed) return
      const nextMouth = speaking(model),
        nextBlink = blinking(model)
      const nextExpression = expressionFor(model)
      if (nextExpression !== lastExpression) {
        const frames = framesFor(model)
        for (let index = 0; index < images.length; index++) {
          const replacement = createImage(frames[index], index === model.direction)
          content.replace(images[index], replacement)
          images[index] = replacement
        }
        overlay.invalidate()
      } else if (model.direction !== lastDirection) {
        images[lastDirection].visible = false
        images[model.direction].visible = true
        overlay.invalidate()
      } else if (nextExpression === 'neutral') {
        if (nextMouth !== lastMouth) {
          const offset = position(content),
            mouth = frameFor(model).mouth
          overlay.invalidate(offset.x + mouth.x, offset.y + mouth.y, mouth.width, mouth.height)
        }
        if (nextBlink !== lastBlink) {
          const offset = position(content),
            eyes = frameFor(model).eyes
          overlay.invalidate(offset.x + eyes.x, offset.y + eyes.y, eyes.width, eyes.height)
        }
      }
      if (nextExpression !== 'neutral') {
        if (nextExpression !== lastExpression || model.direction !== lastDirection) {
          const frame = frameFor(model)
          eyeImage = replacePatch(eyeImage, frame.eyes, nextBlink)
          mouthImage = replacePatch(mouthImage, frame.mouth, nextMouth)
        } else {
          eyeImage.visible = nextBlink
          mouthImage.visible = nextMouth
        }
      } else {
        if (eyeImage) eyeImage.visible = false
        if (mouthImage) mouthImage.visible = false
      }
      lastExpression = nextExpression
      lastBlink = nextBlink
      lastDirection = model.direction
      lastMouth = nextMouth
    },
  })
  function replacePatch(previous, patch, visible) {
    const offset = position(content)
    const image = new Image(null, {
      left: offset.x + patch.x,
      top: offset.y + patch.y,
      width: patch.width,
      height: patch.height,
      path: patch.image,
      visible,
    })
    if (previous) content.replace(previous, image)
    else content.add(image)
    return image
  }
  function schedule() {
    content?.stop()
    if (!content || !displayed || closed) return
    content.interval = model.state === 'speak' ? 250 : model.eyeOpen ? 3000 + Math.floor(model.random() * 2000) : 120
    content.start()
  }
  model.mouthOpen = false
  model.resumeAnimation = () => {
    displayed = true
    schedule()
  }
  model.pauseAnimation = () => {
    displayed = false
    content.stop()
  }
  model.animate = () => {
    if (!displayed || closed) return
    if (model.state === 'speak') model.mouthOpen = !model.mouthOpen
    else model.eyeOpen = !model.eyeOpen
    model.invalidate()
    schedule()
  }
  const setState = model.setState
  model.setState = function (state) {
    if (closed) return
    const previous = this.state
    setState.call(this, state)
    if (state !== previous && (state === 'speak' || previous === 'speak')) {
      this.mouthOpen = false
      this.eyeOpen = true
      schedule()
    }
  }
  const createImage = (frame, visible) =>
    new Image(null, {
      left: 0,
      top: 0,
      width: atlas.width,
      height: atlas.height,
      path: frame.image,
      visible,
    })
  images = frameSets.neutral.map((frame, index) => createImage(frame, index === 4))
  overlay = new Port({ model, frameFor }, { left: 0, right: 0, top: 0, bottom: 0, Behavior: FaceOverlayBehavior })
  content = new Container(model, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    active: true,
    clip: true,
    Behavior: AvatarBehavior,
    contents: [...images, overlay],
  })
  return {
    model,
    content,
    close() {
      if (closed) return
      model.eyeOpen = true
      model.mouthOpen = false
      model.setState('idle')
      closed = true
      displayed = false
      content.stop()
    },
  }
}
