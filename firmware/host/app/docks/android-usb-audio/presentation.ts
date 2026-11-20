import type { StackchanContext, UIEffect } from 'capabilities'
import { SpeechBalloon } from 'effects/speech-balloon'
import { Container, Content, Label, Skin, Style } from 'piu/MC'
import type { TaskExecutionState } from 'stackchan-application-event'
import {
  formatUsbAudioCaption,
  USB_AUDIO_MOUTH_STEP,
  usbAudioMouthStep,
  usbAudioStatusVisual,
  usbTaskStatusVisual,
} from 'stackchan-usb-dock-presentation-model'
import { StackChanStatus } from 'stackchan-usb-media-session'
import Timer from 'timer'

const BALLOON_HEIGHT = 44
const MOUTH_UPDATE_MILLISECONDS = 125
const STATUS_BADGE_SIZE = 28
const STATUS_ICON_SIZE = 16
const SPINNER_FRAME_COUNT = 4
const SPINNER_VARIANT_STRIDE = STATUS_ICON_SIZE
const STATUS_ICON_OFFSET = (STATUS_BADGE_SIZE - STATUS_ICON_SIZE) / 2

const statusBadgeSkin = new Skin({ fill: '#202428' })
const statusMicrophoneSkin = new Skin({
  texture: { path: 'microphone.png' },
  color: ['#ffffff', '#ffffff'],
  x: 0,
  y: 0,
  width: STATUS_ICON_SIZE,
  height: STATUS_ICON_SIZE,
  states: STATUS_ICON_SIZE,
})
const statusRecognizingIndicatorSkin = new Skin({
  texture: { path: 'indicator.png' },
  color: ['#ffffff'],
  x: 0,
  y: 0,
  width: STATUS_ICON_SIZE,
  height: STATUS_ICON_SIZE,
  variants: SPINNER_VARIANT_STRIDE,
})
const statusConnectingIndicatorSkin = new Skin({
  texture: { path: 'indicator.png' },
  color: ['#ffb000'],
  x: 0,
  y: 0,
  width: STATUS_ICON_SIZE,
  height: STATUS_ICON_SIZE,
  variants: SPINNER_VARIANT_STRIDE,
})
const taskRunningIndicatorSkin = new Skin({
  texture: { path: 'indicator.png' },
  color: ['#42bde8'],
  x: 0,
  y: 0,
  width: STATUS_ICON_SIZE,
  height: STATUS_ICON_SIZE,
  variants: SPINNER_VARIANT_STRIDE,
})
const statusErrorStyle = new Style({
  font: 'k8x12-12',
  color: '#ff5252',
  horizontal: 'center',
  vertical: 'middle',
})

class SpinningIndicatorBehavior extends Behavior {
  #frame = 0

  onDisplaying(content: Content) {
    content.variant = 0
    content.interval = 250
    content.time = 0
    content.start()
  }

  onTimeChanged(content: Content) {
    this.#frame = (this.#frame + 1) % SPINNER_FRAME_COUNT
    content.variant = this.#frame
  }

  onUndisplaying(content: Content) {
    content.stop()
  }
}

const UsbAudioStatusBadge = Container.template((status: StackChanStatus) => {
  const visual = usbAudioStatusVisual(status)
  const contents =
    visual.kind === 'error'
      ? [
          new Label(null, {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            string: '!',
            style: statusErrorStyle,
          }),
        ]
      : visual.kind === 'hidden'
        ? []
        : [
            new Content(null, {
              left: STATUS_ICON_OFFSET,
              top: STATUS_ICON_OFFSET,
              width: STATUS_ICON_SIZE,
              height: STATUS_ICON_SIZE,
              skin:
                visual.kind === 'spinner'
                  ? visual.color === 'amber'
                    ? statusConnectingIndicatorSkin
                    : statusRecognizingIndicatorSkin
                  : statusMicrophoneSkin,
              state: visual.kind === 'microphone' && visual.muted ? 1 : 0,
              variant: 0,
              active: false,
              Behavior: visual.kind === 'spinner' ? SpinningIndicatorBehavior : undefined,
            }),
          ]
  return {
    name: 'usb-audio-status',
    right: 8,
    top: 8,
    width: STATUS_BADGE_SIZE,
    height: STATUS_BADGE_SIZE,
    skin: statusBadgeSkin,
    active: false,
    contents,
  }
})

const UsbTaskStatusBadge = Container.template((state: TaskExecutionState) => {
  const visual = usbTaskStatusVisual(state)
  return {
    name: 'usb-task-status',
    right: 40,
    top: 8,
    width: STATUS_BADGE_SIZE,
    height: STATUS_BADGE_SIZE,
    skin: statusBadgeSkin,
    active: false,
    contents:
      visual.kind === 'spinner'
        ? [
            new Content(null, {
              left: STATUS_ICON_OFFSET,
              top: STATUS_ICON_OFFSET,
              width: STATUS_ICON_SIZE,
              height: STATUS_ICON_SIZE,
              skin: taskRunningIndicatorSkin,
              variant: 0,
              active: false,
              Behavior: SpinningIndicatorBehavior,
            }),
          ]
        : [],
  }
})

type CaptionBalloon = UIEffect & {
  delegate?: (message: string, value?: string) => unknown
}

export type UsbAudioPresentation = {
  onStatusChanged(status: StackChanStatus): void
  onTaskStateChanged(state: TaskExecutionState): void
  onPlaybackStarted(): void
  onPlaybackPower(power: number): void
  onPlaybackText(text: string): void
  onPlaybackStopped(): void
  close(): void
}

export function createUsbAudioPresentation(context: StackchanContext): UsbAudioPresentation {
  let active = false
  let balloon: CaptionBalloon | undefined
  let statusBadge: UIEffect | undefined
  let taskBadge: UIEffect | undefined
  let status = StackChanStatus.IDLE
  let taskState: TaskExecutionState = 'idle'
  let mouthTimer: ReturnType<typeof Timer.repeat> | undefined
  let pendingMouthStep = 0
  let displayedMouthStep = 0
  let closed = false

  const displayWidth = () => {
    const application = context.ui.application as { width?: number } | undefined
    return application?.width && application.width > 0 ? application.width : 320
  }

  const flushMouth = () => {
    if (pendingMouthStep === displayedMouthStep) return
    displayedMouthStep = pendingMouthStep
    context.face.setMouthOpen(displayedMouthStep * USB_AUDIO_MOUTH_STEP)
  }

  const removeBalloon = () => {
    if (!balloon) return
    context.ui.removeEffect(balloon)
    balloon = undefined
  }

  const removeStatusBadge = () => {
    if (!statusBadge) return
    context.ui.removeEffect(statusBadge)
    statusBadge = undefined
  }

  const removeTaskBadge = () => {
    if (!taskBadge) return
    context.ui.removeEffect(taskBadge)
    taskBadge = undefined
  }

  const updateStatusBadge = () => {
    const displayedStatus = active ? StackChanStatus.SPEAKING : status
    removeStatusBadge()
    if (displayedStatus === StackChanStatus.IDLE) return
    statusBadge = new UsbAudioStatusBadge(displayedStatus) as UIEffect
    context.ui.addEffect(statusBadge, 'usb-audio-status')
  }

  const updateTaskBadge = () => {
    removeTaskBadge()
    if (taskState === 'idle') return
    taskBadge = new UsbTaskStatusBadge(taskState) as UIEffect
    context.ui.addEffect(taskBadge, 'usb-task-status')
  }

  const showCaption = (text: string) => {
    const formatted = formatUsbAudioCaption(text, displayWidth())
    if (!formatted) return
    if (balloon?.delegate) {
      balloon.delegate('setText', formatted)
      return
    }
    removeBalloon()
    balloon = new SpeechBalloon({
      name: 'usb-audio-caption',
      left: 0,
      right: 0,
      bottom: 4,
      height: BALLOON_HEIGHT,
      text: formatted,
      font: 'k8x12-12',
    }) as CaptionBalloon
    context.ui.addEffect(balloon, 'usb-audio-caption')
  }

  const stopPlayback = (refreshStatus: boolean) => {
    if (mouthTimer) Timer.clear(mouthTimer)
    mouthTimer = undefined
    pendingMouthStep = 0
    displayedMouthStep = 0
    context.face.setMouthOpen(0)
    removeBalloon()
    if (active) context.ui.setFaceMotionEnabled?.(true)
    active = false
    if (status === StackChanStatus.SPEAKING) status = StackChanStatus.IDLE
    if (refreshStatus) updateStatusBadge()
  }

  return {
    onStatusChanged(nextStatus) {
      if (closed) return
      status = nextStatus
      updateStatusBadge()
    },

    onTaskStateChanged(nextState) {
      if (closed) return
      taskState = nextState
      updateTaskBadge()
    },

    onPlaybackStarted() {
      if (closed || active) return
      active = true
      updateStatusBadge()
      pendingMouthStep = 0
      displayedMouthStep = 0
      context.ui.setFaceMotionEnabled?.(false)
      context.face.setMouthOpen(0)
      mouthTimer = Timer.repeat(flushMouth, MOUTH_UPDATE_MILLISECONDS)
    },

    onPlaybackPower(power) {
      if (closed || !active) return
      pendingMouthStep = usbAudioMouthStep(power)
      if (pendingMouthStep === 0) flushMouth()
    },

    onPlaybackText(text) {
      if (closed || !active) return
      showCaption(text)
    },

    onPlaybackStopped() {
      if (closed) return
      stopPlayback(true)
    },

    close() {
      if (closed) return
      closed = true
      stopPlayback(false)
      removeStatusBadge()
      removeTaskBadge()
    },
  }
}

export default createUsbAudioPresentation
