import { FaceBase, type FaceBaseParams } from 'behaviors/face'
import type { FaceState } from 'face-state'
import { STACKCHAN_DEMO_IMAGE_AVATAR_PACK } from 'parts/image/image-avatar-pack'
import { frameIndexForRatio } from 'parts/image/image-avatar-state'
import type { Content as PiuContent } from 'piu/MC'

// Reuse the demo avatar's light head so the black frames remain visible on black.
const normal = STACKCHAN_DEMO_IMAGE_AVATAR_PACK.expressions.normal
const head = normal.head
const mouth = normal.mouth
const frames = mouth.frames
const headSkin = new Skin({
  texture: { path: head.texture },
  width: head.width,
  height: head.height,
  color: head.color,
})
const glassesSkin = new Skin({ texture: { path: 'deal-with-it-eyes.png' }, width: 144, height: 36 })
const mouthSkin = new Skin({
  texture: { path: frames.texture },
  width: frames.frameWidth,
  height: frames.frameHeight,
  variants: frames.frameWidth,
  color: mouth.color,
})

export const DealWithItFace = FaceBase.template(($: FaceBaseParams = {}) => ({
  left: $.left ?? 60,
  top: $.top ?? 60,
  width: $.width ?? 200,
  height: $.height ?? 120,
  motions: $.motions,
  contents: [
    new Content(null, { left: head.x, top: head.y, width: head.width, height: head.height, skin: headSkin }),
    // One static, untinted texture replaces both eyes. No blink/gaze handlers.
    // Already enlarged 3x with nearest-neighbor; Piu draws at native resolution.
    new Content(null, { left: 28, top: 24, width: 144, height: 36, skin: glassesSkin }),
    new Content(null, {
      left: mouth.x,
      top: mouth.y,
      width: frames.frameWidth,
      height: frames.frameHeight,
      skin: mouthSkin,
      Behavior: class extends Behavior {
        onFaceState(content: PiuContent, face: FaceState) {
          content.variant = frameIndexForRatio(face.mouth.open, frames.frameCount)
        }
      },
    }),
  ],
}))
