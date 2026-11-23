import { FaceBase } from 'behaviors/face'
import type { FaceState } from 'face-state'
import { GURUGURU_FRAMES, GURUGURU_SIZE } from 'guruguru-face/frames'
import { Container, Content, type Container as PiuContainer, type Content as PiuContent, Skin } from 'piu/MC'

const CENTER_DIRECTION = 4
const OPEN_THRESHOLD = 0.5

type PatchGeometry = { left: number; top: number; width: number; height: number }
type Pose = { container: PiuContainer; eyes: PiuContent; mouth: PiuContent }

function directionIndex(gaze: number): number {
  if (gaze < -1 / 3) return 0
  if (gaze > 1 / 3) return 2
  return 1
}

function createPatch(path: string, geometry: PatchGeometry): PiuContent {
  const { width, height } = geometry
  return new Content(null, {
    ...geometry,
    skin: new Skin({ texture: { path }, width, height }),
    visible: false,
  })
}

function createPose(frame: (typeof GURUGURU_FRAMES)[number], index: number): Pose {
  const eyes = createPatch(`guruguru-eyes-${index}.png`, frame.eyes)
  const mouth = createPatch(`guruguru-mouth-${index}.png`, frame.mouth)
  const head = new Content(null, {
    left: 0,
    top: 0,
    width: GURUGURU_SIZE,
    height: GURUGURU_SIZE,
    skin: new Skin({ texture: { path: `guruguru-head-${index}.png` }, width: GURUGURU_SIZE, height: GURUGURU_SIZE }),
  })
  const container = new Container(null, {
    left: 0,
    top: 0,
    width: GURUGURU_SIZE,
    height: GURUGURU_SIZE,
    visible: index === CENTER_DIRECTION,
    contents: [head, eyes, mouth],
  })
  return { container, eyes, mouth }
}

class GuruguruArtworkBehavior extends Behavior {
  private poses!: Pose[]
  private direction = CENTER_DIRECTION

  onCreate(_container: PiuContainer, poses: Pose[]): void {
    this.poses = poses
  }

  onFaceState(_container: PiuContainer, face: FaceState): void {
    const { left, right } = face.eyes
    const column = directionIndex((left.gazeX + right.gazeX) / 2)
    const row = directionIndex((left.gazeY + right.gazeY) / 2)
    const direction = row * 3 + column
    const pose = this.poses[direction]

    pose.eyes.visible = Math.min(left.open, right.open) < OPEN_THRESHOLD
    pose.mouth.visible = face.mouth.open >= OPEN_THRESHOLD
    if (direction !== this.direction) {
      this.poses[this.direction].container.visible = false
      pose.container.visible = true
      this.direction = direction
    }
  }
}

export function createGuruguruFace(): PiuContainer {
  const poses = GURUGURU_FRAMES.map(createPose)
  const artwork = new Container(poses, {
    left: 0,
    top: 0,
    width: GURUGURU_SIZE,
    height: GURUGURU_SIZE,
    Behavior: GuruguruArtworkBehavior,
    contents: poses.map((pose) => pose.container),
  })
  const face = new FaceBase({
    left: (320 - GURUGURU_SIZE) / 2,
    top: (240 - GURUGURU_SIZE) / 2,
    width: GURUGURU_SIZE,
    height: GURUGURU_SIZE,
    breathPixels: 0,
    contents: [artwork],
  })
  if (face.behavior) Object.assign(face.behavior, { preservePositionOnSwap: false })
  return face
}
