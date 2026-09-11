import { DogFace, FaceBase, ImageFace, SimpleFace } from 'behaviors/face'
import { createCameraPreviewDialog, prepareCameraPreviewFrame } from 'camera-preview'
import type { RobotUI, ShowBalloonOptions, UIEffect } from 'capabilities'
import { Emoticon } from 'effects/emoticon'
import { MusicNotes } from 'effects/music-notes'
import { SpeechBalloon } from 'effects/speech-balloon'
import {
  createFaceState,
  type Emotion,
  type FaceEyeKey,
  type FaceState,
  type FaceThemeKey,
  setColorRGB,
} from 'face-state'
import { Hands } from 'hands'
import { OwnedResources, ResourceScope } from 'owned-resources'
import { Eye } from 'parts/eye'
import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import { Mouth } from 'parts/mouth'
import { ownUI } from 'runtime-resources'
import type { CameraImage } from 'stackchan/camera'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import type { Emoticon as EmoticonName, FaceStyle, FaceTracking, HandAnimation } from 'stackchan/extensions/ui'
import type { ImageAvatarPack } from 'stackchan/image-avatar'
import { type ShapeFace, validateShapeFace } from 'stackchan/shape-face'
import {
  type Pose,
  type Rotation,
  type Vector3,
  writeBodyRelativeVector3,
  writePositionRelativeVector3,
  writeRotationFromVector3,
} from 'stackchan-util'

const LEFT_RIGHT = Object.freeze(['left', 'right'] as const)

export type RuntimeUIPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

type RuntimeUIOptions = {
  restoreFace?: () => void
  getPose: () => RuntimeUIPose
  getGazePoint: () => Vector3 | null | undefined
}

const BALLOON_OPTION_KEYS = ['left', 'right', 'top', 'bottom', 'width', 'height', 'tail'] as const

type SpeechBalloonBehavior = {
  setText?: (content: UIEffect, text: string) => void
}

function sameBalloonOptions(current: ShowBalloonOptions | null, next: ShowBalloonOptions): boolean {
  if (!current) return false
  return BALLOON_OPTION_KEYS.every((key) => current[key] === next[key])
}

export class StackchanRuntimeUI {
  #emoticon: UIEffect | undefined
  #faceStyle: FaceStyle | 'shape'
  #image: UIEffect | undefined
  #balloon: UIEffect | null = null
  #balloonOptions: ShowBalloonOptions | null = null
  #emotion: Emotion
  #eyeOpen = { left: 1, right: 1 }
  #eyeGazePoint: Vector3 = [0, 0, 0]
  #eyeGazeRotation: Rotation = { y: 0, p: 0, r: 0 }
  #faceState: FaceState
  #mouthOpen = 0
  #options: RuntimeUIOptions
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #ui: RobotUI
  #devices: ResourceScope
  #shutdown: OwnedResources | undefined

  constructor(ui: RobotUI, options: RuntimeUIOptions, devices?: ResourceScope) {
    this.#ui = ui
    this.#options = options
    this.#faceStyle = 'default'
    this.#faceState = createFaceState()
    this.#emotion = this.#faceState.emotion
    this.#devices = devices ?? new ResourceScope()
    if (!devices) ownUI(this.#devices, ui)
  }

  get faceStyle(): FaceStyle | 'shape' {
    return this.#faceStyle
  }

  setFaceStyle(style: FaceStyle): void {
    this.#assertOpen()
    if (!['default', 'simple', 'dog', 'image', 'avatar'].includes(style))
      throw new StackchanError('INVALID_ARGUMENT', 'Unknown face style')
    if (style === 'default' && this.#options.restoreFace) this.#options.restoreFace()
    else if (style === 'avatar') this.#ui.setFace(new ImageAvatarFace({}))
    else
      this.#ui.setFace(style === 'dog' ? new DogFace({}) : style === 'image' ? new ImageFace({}) : new SimpleFace({}))
    this.#faceStyle = style
  }

  setImageAvatar(pack: ImageAvatarPack): void {
    this.#assertOpen()
    this.#ui.setFace(new ImageAvatarFace({ pack }))
    this.#faceStyle = 'avatar'
  }

  setShapeFace(value: ShapeFace): void {
    this.#assertOpen()
    validateShapeFace(value)
    const { canvas, shape } = JSON.parse(JSON.stringify(value)) as ShapeFace
    const eyes = (['left', 'right'] as const).map((side) => {
      const { x, y, ...eye } = shape.eyes[side]
      return new Eye({ ...eye, cx: x, cy: y, side })
    })
    const { x, y, visible, ...mouth } = shape.mouth
    this.#ui.setFace(
      new FaceBase({
        ...canvas,
        contents: [...eyes, ...(visible ? [new Mouth({ ...mouth, cx: x, cy: y })] : [])],
      }),
    )
    this.#faceStyle = 'shape'
  }

  setHandAnimation(animation: HandAnimation): void {
    this.#assertOpen()
    if (!['none', 'rock-paper-scissors', 'clap', 'thinking'].includes(animation))
      throw new StackchanError('INVALID_ARGUMENT', 'Unknown hand animation')
    this.#ui.setHandAnimation(animation)
  }

  setEmoticon(name: EmoticonName | null): void {
    this.#assertOpen()
    if (name !== null && !['heart', 'angry', 'sweat', 'tear', 'sleepy'].includes(name))
      throw new StackchanError('INVALID_ARGUMENT', 'Unknown emoticon')
    const previous = this.#emoticon
    this.#emoticon = undefined
    if (previous) this.#ui.removeEffect(previous)
    if (name !== null) {
      const effect = new Emoticon({ key: name, name: 'emotion' })
      this.#emoticon = effect
      try {
        this.#ui.addEffect(effect)
      } catch (error) {
        this.#emoticon = undefined
        this.#ui.removeEffect(effect)
        throw error
      }
    }
  }

  #trackedHands: UIEffect | undefined
  #musicNotes: UIEffect | undefined
  setTracking(value: FaceTracking | null): void {
    if (value) {
      for (const openness of [value.leftEye, value.rightEye, value.mouth]) finiteNumber(openness, 'face openness', 0, 1)
      for (const hand of Object.values(value.hands)) {
        if (!hand) continue
        if (!['fist', 'point', 'peace', 'open'].includes(hand.shape))
          throw new StackchanError('INVALID_ARGUMENT', 'Unknown hand shape')
        finiteNumber(hand.x, 'hand x', 0, 320)
        finiteNumber(hand.y, 'hand y', 0, 240)
        finiteNumber(hand.rotationDeg, 'hand rotation', -360, 360)
      }
    }
    this.setEyeOpen('left', value?.leftEye ?? 1)
    this.setEyeOpen('right', value?.rightEye ?? 1)
    this.setMouthOpen(value?.mouth ?? 0)
    if (!value) {
      const effect = this.#trackedHands
      this.#trackedHands = undefined
      if (effect) this.#ui.removeEffect(effect)
      return
    }
    if (!this.#trackedHands) {
      this.#trackedHands = new Hands({})
      this.#ui.addEffect(this.#trackedHands)
    }
    const hands = Object.fromEntries(
      Object.entries(value.hands).flatMap(([side, hand]) =>
        hand
          ? [
              [
                side,
                {
                  shape: hand.shape,
                  pose: { position: { x: hand.x, y: hand.y }, rotation: { r: (hand.rotationDeg * Math.PI) / 180 } },
                },
              ],
            ]
          : [],
      ),
    )
    this.#trackedHands.delegate('onHandPoseChanged', hands)
  }
  setMusicNotes(enabled: boolean): void {
    if (enabled && !this.#musicNotes) {
      this.#musicNotes = new MusicNotes({})
      this.#ui.addEffect(this.#musicNotes)
    }
    if (!enabled && this.#musicNotes) {
      const effect = this.#musicNotes
      this.#musicNotes = undefined
      this.#ui.removeEffect(effect)
    }
  }
  setFaceMotionEnabled(enabled: boolean): void {
    this.#ui.setFaceMotionEnabled?.(enabled)
  }

  resetAppearance(): Promise<void> {
    return new ResourceScope([
      () => this.setTracking(null),
      () => this.setMusicNotes(false),
      () => this.setFaceMotionEnabled(true),
      () => {
        this.#faceState = createFaceState()
        this.#emotion = this.#faceState.emotion
        this.#mouthOpen = 0
      },
      () => this.setFaceStyle('default'),
      () => this.setHandAnimation('none'),
      () => this.setEmoticon(null),
    ]).close()
  }

  get ui(): RobotUI {
    return this.#ui
  }

  showBalloon(text: string, option: ShowBalloonOptions = {}) {
    this.#assertOpen()
    if (this.#balloon != null && sameBalloonOptions(this.#balloonOptions, option)) {
      const behavior = this.#balloon.behavior as SpeechBalloonBehavior | undefined
      if (behavior?.setText) {
        behavior.setText(this.#balloon, text)
        return
      }
    }
    this.hideBalloon()
    this.#balloon = new SpeechBalloon({ ...option, text })
    this.#balloonOptions = { ...option }
    this.#ui.addEffect(this.#balloon)
  }

  hideBalloon() {
    const balloon = this.#balloon
    this.#balloon = null
    this.#balloonOptions = null
    if (balloon != null) this.#ui.removeEffect(balloon)
  }

  showImage(image: CameraImage): void {
    this.#assertOpen()
    if (image.format !== 'rgb565le' && image.format !== 'rgb565be')
      throw new StackchanError('UNSUPPORTED', 'Image display requires RGB565')
    if (
      !Number.isInteger(image.width) ||
      image.width < 1 ||
      image.width > 320 ||
      !Number.isInteger(image.height) ||
      image.height < 1 ||
      image.height > 240 ||
      !(image.data instanceof ArrayBuffer) ||
      image.data.byteLength !== image.width * image.height * 2
    )
      throw new StackchanError('INVALID_ARGUMENT', 'Invalid image')
    this.hideImage()
    const frame = prepareCameraPreviewFrame({
      width: image.width,
      height: image.height,
      imageType: image.format,
      buffer: image.data,
    })
    const effect = createCameraPreviewDialog(frame, {
      onDismiss: () => {
        if (this.#image === effect) this.hideImage()
      },
    })
    this.#image = effect
    try {
      this.#ui.addEffect(effect)
    } catch (error) {
      this.hideImage()
      throw error
    }
  }

  hideImage(): void {
    const image = this.#image
    this.#image = undefined
    if (image) this.#ui.removeEffect(image)
  }

  setColor(key: FaceThemeKey, r: number, g: number, b: number): void {
    setColorRGB(this.#faceState.theme[key], r, g, b)
  }

  setEmotion(emotion: Emotion) {
    this.#emotion = emotion
  }

  setEyeOpen(key: FaceEyeKey, value: number) {
    if (value < 0 || value > 1) {
      throw new Error('value must be between 0 and 1')
    }
    this.#eyeOpen[key] = value
  }

  setMouthOpen(value: number) {
    if (value < 0 || value > 1) {
      throw new Error('value must be between 0 and 1')
    }
    this.#mouthOpen = value
  }

  updateFace(interval: number) {
    if (this.#shutdown) {
      return
    }

    const pose = this.#options.getPose()
    const gazePoint = this.#options.getGazePoint()
    this.#faceState.mouth.open = this.#mouthOpen
    this.#faceState.eyes.left.open = this.#eyeOpen.left
    this.#faceState.eyes.right.open = this.#eyeOpen.right
    this.#faceState.emotion = this.#emotion

    if (gazePoint != null) {
      writeBodyRelativeVector3(this.#relativeGazePoint, gazePoint, pose.body.rotation)
      for (const key of LEFT_RIGHT) {
        const pos = pose.eyes[key].position
        writePositionRelativeVector3(this.#eyeGazePoint, this.#relativeGazePoint, pos)
        writeRotationFromVector3(this.#eyeGazeRotation, this.#eyeGazePoint)
        const eye = this.#faceState.eyes[key]
        eye.gazeX = Math.cos(this.#eyeGazeRotation.y)
        eye.gazeY = Math.cos(this.#eyeGazeRotation.p)
      }
    }

    this.#ui.update(interval, this.#faceState)
  }

  close(): Promise<void> {
    if (!this.#shutdown) {
      this.#shutdown = new OwnedResources([
        () => this.hideImage(),
        () => this.hideBalloon(),
        () => this.#devices.close(),
      ])
    }
    return this.#shutdown.close()
  }

  #assertOpen(): void {
    if (this.#shutdown) throw new StackchanError('CLOSED', 'UI is closed')
  }
}
