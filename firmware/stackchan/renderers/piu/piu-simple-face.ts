import type { Content, Container } from 'piu/MC'
import { PiuRendererBase, type FaceContext } from './piu-renderer-base'
import { createBlinkBehavior, createBreathBehavior, createSaccadeBehavior } from './piu-face-behaviors'

const blackSkin = new Skin({ fill: 'black' })

// Eye Iris (pupil) Behavior
class IrisBehavior extends Behavior {
  side: keyof FaceContext['eyes']
  baseX: number
  baseY: number
  radius: number

  onCreate(
    _content: Content,
    data: { side: keyof FaceContext['eyes']; baseX: number; baseY: number; radius?: number },
  ) {
    this.side = data.side
    this.baseX = data.baseX
    this.baseY = data.baseY
    this.radius = data.radius ?? 8
  }

  onFaceContextChanged(content: Content, context: Readonly<FaceContext>) {
    const eye = context.eyes[this.side]
    const offsetX = (eye.gazeX ?? 0) * 2
    const offsetY = (eye.gazeY ?? 0) * 2
    content.position = {
      x: this.baseX + offsetX - this.radius,
      y: this.baseY + offsetY - this.radius,
    }
  }
}

// Eye Eyelid Behavior
class EyelidBehavior extends Behavior {
  side: keyof FaceContext['eyes']
  baseX: number
  baseY: number
  width: number
  height: number

  onCreate(
    _content: Content,
    data: { side: keyof FaceContext['eyes']; baseX: number; baseY: number; width: number; height: number },
  ) {
    this.side = data.side
    this.baseX = data.baseX
    this.baseY = data.baseY
    this.width = data.width
    this.height = data.height
  }

  onFaceContextChanged(content: Content, context: Readonly<FaceContext>) {
    const eye = context.eyes[this.side]
    const closedHeight = this.height * (1 - eye.open)

    let y = this.baseY - this.height / 2
    let height = closedHeight

    // Adjust based on emotion
    switch (context.emotion) {
      case 'ANGRY':
      case 'SAD':
        // Create angled eyelids - approximate with top positioning
        if (this.side === 'left') {
          y = context.emotion === 'ANGRY' ? this.baseY - this.height / 2 : this.baseY - this.height / 4
        } else {
          y = context.emotion === 'ANGRY' ? this.baseY - this.height / 4 : this.baseY - this.height / 2
        }
        break
      case 'SLEEPY':
        height = this.height * 0.5 + closedHeight * 0.5
        break
      case 'HAPPY':
        // Happy eyes with breaks - approximate with reduced height
        height = closedHeight * 0.6
        break
    }

    content.coordinates = {
      left: this.baseX - this.width / 2,
      top: y,
    }
    content.size = {
      width: this.width,
      height: height,
    }
  }
}

// Mouth Behavior
class MouthBehavior extends Behavior {
  baseX: number
  baseY: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number

  onCreate(
    _content: Content,
    data: {
      baseX: number
      baseY: number
      minWidth?: number
      maxWidth?: number
      minHeight?: number
      maxHeight?: number
    },
  ) {
    this.baseX = data.baseX
    this.baseY = data.baseY
    this.minWidth = data.minWidth ?? 50
    this.maxWidth = data.maxWidth ?? 90
    this.minHeight = data.minHeight ?? 8
    this.maxHeight = data.maxHeight ?? 58
  }

  onFaceContextChanged(content: Content, context: Readonly<FaceContext>) {
    const openRatio = context.mouth.open
    const h = this.minHeight + (this.maxHeight - this.minHeight) * openRatio
    const w = this.minWidth + (this.maxWidth - this.minWidth) * (1 - openRatio)

    content.coordinates = {
      left: this.baseX - w / 2,
      top: this.baseY - h / 2,
    }
    content.size = {
      width: w,
      height: h,
    }
  }
}

// Face Container Behavior (for breath effect)
class FaceBehavior extends Behavior {
  baseY: number

  onCreate(_container: Container, data: { baseY?: number }) {
    this.baseY = data.baseY ?? 0
  }

  onFaceContextChanged(container: Container, context: Readonly<FaceContext>) {
    const breathOffset = context.breath * 3
    container.coordinates = {
      ...container.coordinates,
      top: this.baseY + breathOffset,
    }
  }
}

export class PiuSimpleFaceRenderer extends PiuRendererBase {
  constructor(behaviorData?: unknown, dictionary?: Record<string, unknown>) {
    super(behaviorData, dictionary ?? {})

    // Add face behaviors (equivalent to the old modifiers)
    this.addBehavior(
      createBlinkBehavior({
        openMin: 400,
        openMax: 5000,
        closeMin: 200,
        closeMax: 400,
      }),
    )
    this.addBehavior(createBreathBehavior({ duration: 6000 }))
    this.addBehavior(createSaccadeBehavior({ updateMin: 300, updateMax: 2000, gain: 0.2 }))

    // Set up the UI structure
    this.skin = blackSkin // Background (secondary color)

    // Face Container
    const face = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      Behavior: FaceBehavior,
      contents: [
        // Left Eye Container
        new Container(null, {
          left: 90 - 12,
          width: 24,
          top: 93 - 12,
          height: 24,
          contents: [
            // Left Iris
            new Content(null, {
              width: 16,
              height: 16,
              skin: blackSkin,
              Behavior: IrisBehavior,
            }),
            // Left Eyelid
            new Content(null, {
              left: 0,
              top: 0,
              right: 0,
              height: 0,
              skin: blackSkin,
              Behavior: EyelidBehavior,
            }),
          ],
        }),

        // Right Eye Container
        new Container(null, {
          left: 230 - 12,
          width: 24,
          top: 96 - 12,
          height: 24,
          contents: [
            // Right Iris
            new Content(null, {
              width: 16,
              height: 16,
              skin: blackSkin,
              Behavior: IrisBehavior,
            }),
            // Right Eyelid
            new Content(null, {
              left: 0,
              top: 0,
              right: 0,
              height: 0,
              skin: blackSkin,
              Behavior: EyelidBehavior,
            }),
          ],
        }),

        // Mouth
        new Content(null, {
          width: 50,
          height: 8,
          skin: blackSkin,
          Behavior: MouthBehavior,
        }),
      ],
    })

    // Decorators Container (empty for now)
    const decorators = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    })

    this.add(face)
    this.add(decorators)

    // Initialize behaviors with data
    const leftEyeContainer = face.first as Container
    const leftIris = leftEyeContainer.first as Content
    const leftEyelid = leftEyeContainer.last as Content

    const leftIrisBehavior = leftIris.behavior as IrisBehavior
    leftIrisBehavior.onCreate(leftIris, { side: 'left', baseX: 12, baseY: 12, radius: 8 })

    const leftEyelidBehavior = leftEyelid.behavior as EyelidBehavior
    leftEyelidBehavior.onCreate(leftEyelid, { side: 'left', baseX: 12, baseY: 12, width: 24, height: 24 })

    const rightEyeContainer = leftEyeContainer.next as Container
    const rightIris = rightEyeContainer.first as Content
    const rightEyelid = rightEyeContainer.last as Content

    const rightIrisBehavior = rightIris.behavior as IrisBehavior
    rightIrisBehavior.onCreate(rightIris, { side: 'right', baseX: 12, baseY: 12, radius: 8 })

    const rightEyelidBehavior = rightEyelid.behavior as EyelidBehavior
    rightEyelidBehavior.onCreate(rightEyelid, { side: 'right', baseX: 12, baseY: 12, width: 24, height: 24 })

    const mouth = rightEyeContainer.next as Content
    const mouthBehavior = mouth.behavior as MouthBehavior
    mouthBehavior.onCreate(mouth, { baseX: 160, baseY: 148 })

    const faceBehavior = face.behavior as FaceBehavior
    faceBehavior.onCreate(face, { baseY: 0 })
  }
}
