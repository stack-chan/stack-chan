import { Emotion } from 'face-state'
import type { ModFeature, ModScope } from 'mod-kit'
import { ok, type Result } from 'stackchan-result'
import { type Pose, randomBetween, type Rotation, wait } from 'stackchan-util'
import Timer from 'timer'

const TOUCH_PANEL_PETTING_WINDOW_MS = 1500
const TOUCH_PANEL_HAPPY_DURATION_MS = 5000
const TOUCH_PANEL_PET_MOTION_STEP_MS = 220
const TOUCH_PANEL_PET_MOTION_STEP_SEC = TOUCH_PANEL_PET_MOTION_STEP_MS / 1000
const MOTION_DETECT_COLD_DURATION_MS = 5000

const SELECTABLE_EMOTIONS: readonly Emotion[] = [
  Emotion.HAPPY,
  Emotion.ANGRY,
  Emotion.SAD,
  Emotion.HOT,
  Emotion.SLEEPY,
  Emotion.NEUTRAL,
]

export type EmotionControlEmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'

export type EmotionControlMotionType =
  | 'upsideDown'
  | 'fallenForward'
  | 'fallenBackward'
  | 'fallenLeft'
  | 'fallenRight'
  | 'shake'

const EMOTION_KEY_MAP: Record<Emotion, EmotionControlEmoticonKey | null> = {
  [Emotion.HAPPY]: 'heart',
  [Emotion.ANGRY]: 'angry',
  [Emotion.SAD]: 'tear',
  [Emotion.HOT]: 'sweat',
  [Emotion.SLEEPY]: 'sleepy',
  [Emotion.NEUTRAL]: null,
  [Emotion.DOUBTFUL]: null,
  [Emotion.COLD]: null,
}

const MOTION_EMOTION_MAP: Record<EmotionControlMotionType, Emotion> = {
  upsideDown: Emotion.SAD,
  fallenForward: Emotion.ANGRY,
  fallenBackward: Emotion.ANGRY,
  fallenLeft: Emotion.ANGRY,
  fallenRight: Emotion.ANGRY,
  shake: Emotion.HOT,
}

export type EmotionControlImu = {
  start(): void
  onEvent?: (event: { readonly motion: EmotionControlMotionType }) => void
}

export type EmotionControlTouchPanel = {
  subscribe(listener: (event: { readonly gesture: string; readonly ticks: number }) => void): () => void
}

export type EmotionControlTimerHandle = unknown

export type EmotionControlTimer = Readonly<{
  set(callback: () => void, interval: number): EmotionControlTimerHandle
  clear(handle: EmotionControlTimerHandle): void
}>

export type EmotionControlDrawerOption = {
  value: string
  label: string
}

export type EmotionControlDeps<TEffect = unknown> = Readonly<{
  setEmotion(emotion: Emotion): void
  addEffect(effect: TEffect): void
  removeEffect(effect: TEffect): void
  createEmoticon(key: EmotionControlEmoticonKey): TEffect
  addDrawerButton(button: {
    key: string
    label: string
    kind: 'choice'
    value: string
    options: EmotionControlDrawerOption[]
    callback: (value?: string) => void
  }): void
  getBodyPose(): Pose
  setPose(pose: Pose, durationSec?: number): Promise<void>
  setTorque(torque: boolean): Promise<void>
  localize(key: string): string
  imu?: EmotionControlImu
  touchPanel?: EmotionControlTouchPanel
  timer?: EmotionControlTimer
  waitMs?: (ms: number) => Promise<void>
  randomBetween?: (min: number, max: number) => number
  random?: () => number
  log?: (message: string) => void
}>

export type EmotionControlError = {
  readonly feature: 'emotion-control'
  readonly reason: string
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function installEmotionControl<TEffect>(
  deps: EmotionControlDeps<TEffect>,
  scope: ModScope,
): Result<void, EmotionControlError> {
  const timer: EmotionControlTimer = deps.timer ?? {
    set: (callback, interval) => Timer.set(callback, interval),
    clear: (handle) => Timer.clear(handle as ReturnType<typeof Timer.set>),
  }
  const waitMs = deps.waitMs ?? wait
  const randomInRange = deps.randomBetween ?? randomBetween
  const nextRandom = deps.random ?? Math.random
  const log = deps.log ?? ((message: string) => trace(message))

  const emotionOptions: EmotionControlDrawerOption[] = [
    { value: String(Emotion.NEUTRAL), label: deps.localize('drawer.emotion.neutral') },
    { value: String(Emotion.HAPPY), label: deps.localize('drawer.emotion.happy') },
    { value: String(Emotion.ANGRY), label: deps.localize('drawer.emotion.angry') },
    { value: String(Emotion.SAD), label: deps.localize('drawer.emotion.sad') },
    { value: String(Emotion.HOT), label: deps.localize('drawer.emotion.hot') },
    { value: String(Emotion.SLEEPY), label: deps.localize('drawer.emotion.sleepy') },
  ]

  let disposed = false
  let emoticonEffect: TEffect | null = null
  let currentEmotion: Emotion = Emotion.NEUTRAL
  let pettingRestoreTimer: EmotionControlTimerHandle | undefined
  let pettingPreviousEmotion: Emotion | undefined
  let pettingPreviousRotation: Rotation | undefined
  let pettingMotionActive = false
  let pettingTorqueOwned = false
  let pettingHoldTimer: EmotionControlTimerHandle | undefined
  let motionDetectRestoreTimer: EmotionControlTimerHandle | undefined
  let motionDetectPreviousEmotion: Emotion | undefined
  let motionDetectEmotion: Emotion | undefined

  const clearTimerHandle = (handle: EmotionControlTimerHandle | undefined): void => {
    if (handle !== undefined) timer.clear(handle)
  }

  const releasePettingTorque = (contextLabel: string): void => {
    if (!pettingTorqueOwned) return
    pettingTorqueOwned = false
    void deps
      .setTorque(false)
      .catch((error) => log(`[TouchPanel] ${contextLabel} torque release error ${errorMessage(error)}\n`))
  }

  const resolveBaseEmotion = (activeReaction: 'imu' | 'petting'): Emotion => {
    if (activeReaction === 'imu') {
      return pettingRestoreTimer !== undefined && currentEmotion === Emotion.HAPPY
        ? (pettingPreviousEmotion ?? currentEmotion)
        : currentEmotion
    }
    return motionDetectRestoreTimer !== undefined && currentEmotion === motionDetectEmotion
      ? (motionDetectPreviousEmotion ?? currentEmotion)
      : currentEmotion
  }

  const setEmotionWithEffect = (nextEmotion: Emotion): void => {
    if (disposed) return
    currentEmotion = nextEmotion
    deps.setEmotion(nextEmotion)
    if (emoticonEffect !== null) {
      deps.removeEffect(emoticonEffect)
      emoticonEffect = null
    }
    const key = EMOTION_KEY_MAP[nextEmotion]
    if (key) {
      emoticonEffect = deps.createEmoticon(key)
      deps.addEffect(emoticonEffect)
    }
  }

  const poseForRotation = (rotation: Rotation): Pose => ({
    position: { ...deps.getBodyPose().position },
    rotation,
  })

  const runPettingHoldMotion = async (upRotation: Rotation): Promise<void> => {
    if (disposed) return
    try {
      await deps.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      log(`[TouchPanel] pet hold motion error ${errorMessage(error)}\n`)
      pettingTorqueOwned = false
      try {
        await deps.setTorque(false)
      } catch (torqueError) {
        log(`[TouchPanel] pet hold torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }

  const runPettingMotion = async (
    upRotation: Rotation,
    leftRight: (direction: number) => Rotation,
    firstDirection: number,
  ): Promise<void> => {
    try {
      if (disposed) return
      await deps.setTorque(true)
      if (disposed) {
        pettingTorqueOwned = false
        try {
          await deps.setTorque(false)
        } catch (torqueError) {
          log(`[TouchPanel] disposed pet motion torque release error ${errorMessage(torqueError)}\n`)
        }
        return
      }
      pettingTorqueOwned = true
      await deps.setPose(poseForRotation(leftRight(firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await waitMs(TOUCH_PANEL_PET_MOTION_STEP_MS)
      if (disposed) return
      await deps.setPose(poseForRotation(leftRight(-firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await waitMs(TOUCH_PANEL_PET_MOTION_STEP_MS)
      if (disposed) return
      await deps.setPose(poseForRotation(leftRight(firstDirection * 0.55)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await waitMs(TOUCH_PANEL_PET_MOTION_STEP_MS)
      if (disposed) return
      await deps.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      if (disposed) return
      pettingHoldTimer = timer.set(() => {
        pettingHoldTimer = undefined
        if (disposed) return
        void runPettingHoldMotion(upRotation)
      }, TOUCH_PANEL_PET_MOTION_STEP_MS * 2)
    } catch (error) {
      log(`[TouchPanel] pet motion error ${errorMessage(error)}\n`)
      pettingTorqueOwned = false
      try {
        await deps.setTorque(false)
      } catch (torqueError) {
        log(`[TouchPanel] pet motion torque release error ${errorMessage(torqueError)}\n`)
      }
    } finally {
      pettingMotionActive = false
    }
  }

  const runPettingRestoreMotion = async (rotation: Rotation): Promise<void> => {
    if (disposed) return
    try {
      await deps.setPose(poseForRotation(rotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      log(`[TouchPanel] restore motion error ${errorMessage(error)}\n`)
    } finally {
      pettingTorqueOwned = false
      try {
        await deps.setTorque(false)
      } catch (torqueError) {
        log(`[TouchPanel] restore torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }

  deps.addDrawerButton({
    key: 'cycleEmotion',
    label: deps.localize('drawer.emotion'),
    kind: 'choice',
    value: String(currentEmotion),
    options: emotionOptions,
    callback: (value) => {
      if (disposed || value === undefined || value === '') return
      const nextEmotion = Number(value) as Emotion
      if (!SELECTABLE_EMOTIONS.includes(nextEmotion) && nextEmotion !== Emotion.NEUTRAL) return
      clearTimerHandle(motionDetectRestoreTimer)
      motionDetectRestoreTimer = undefined
      motionDetectPreviousEmotion = undefined
      motionDetectEmotion = undefined
      let canceledPettingMotion = false
      if (pettingRestoreTimer !== undefined) {
        clearTimerHandle(pettingRestoreTimer)
        pettingRestoreTimer = undefined
        pettingPreviousEmotion = undefined
        pettingPreviousRotation = undefined
        canceledPettingMotion = true
      }
      if (pettingHoldTimer !== undefined) {
        clearTimerHandle(pettingHoldTimer)
        pettingHoldTimer = undefined
        canceledPettingMotion = true
      }
      if (canceledPettingMotion) {
        pettingTorqueOwned = false
        void deps
          .setTorque(false)
          .catch((error) => log(`[TouchPanel] canceled petting torque release error ${errorMessage(error)}\n`))
      }
      setEmotionWithEffect(nextEmotion)
    },
  })

  let imuHandler: ((event: { readonly motion: EmotionControlMotionType }) => void) | undefined
  if (deps.imu != null) {
    deps.imu.start()
    imuHandler = (event) => {
      if (disposed) return
      const type = event.motion
      log(`[IMU] motion detected: ${type}\n`)
      if (motionDetectPreviousEmotion === undefined) {
        motionDetectPreviousEmotion = resolveBaseEmotion('imu')
      }
      clearTimerHandle(motionDetectRestoreTimer)

      const motionEmotion = MOTION_EMOTION_MAP[type]
      motionDetectEmotion = motionEmotion
      setEmotionWithEffect(motionEmotion)
      motionDetectRestoreTimer = timer.set(() => {
        if (disposed) return
        const restoreEmotion =
          pettingRestoreTimer !== undefined ? Emotion.HAPPY : (motionDetectPreviousEmotion ?? Emotion.NEUTRAL)
        if (currentEmotion === motionEmotion) {
          log(`[IMU] restore emotion ${restoreEmotion}\n`)
          setEmotionWithEffect(restoreEmotion)
        }
        motionDetectPreviousEmotion = undefined
        motionDetectEmotion = undefined
        motionDetectRestoreTimer = undefined
      }, MOTION_DETECT_COLD_DURATION_MS)
    }
    deps.imu.onEvent = imuHandler
  }

  let unsubscribeTouchPanel: (() => void) | undefined
  if (deps.touchPanel != null) {
    let lastForwardSwipeTicks: number | undefined
    let lastBackwardSwipeTicks: number | undefined
    unsubscribeTouchPanel = deps.touchPanel.subscribe((event) => {
      if (disposed) return
      const type = event.gesture
      log(`[TouchPanel] gesture: ${type}\n`)
      if (type !== 'forwardSwipe' && type !== 'backwardSwipe') return

      if (type === 'forwardSwipe') lastForwardSwipeTicks = event.ticks
      else lastBackwardSwipeTicks = event.ticks

      const hasRecentForwardSwipe =
        lastForwardSwipeTicks !== undefined && event.ticks - lastForwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      const hasRecentBackwardSwipe =
        lastBackwardSwipeTicks !== undefined && event.ticks - lastBackwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      if (hasRecentForwardSwipe && hasRecentBackwardSwipe) {
        log('[TouchPanel] petting detected: set emotion HAPPY with heart effect\n')
        if (pettingPreviousEmotion === undefined) {
          pettingPreviousEmotion = resolveBaseEmotion('petting')
        }
        if (pettingPreviousRotation === undefined) pettingPreviousRotation = { ...deps.getBodyPose().rotation }
        clearTimerHandle(pettingRestoreTimer)
        if (pettingHoldTimer !== undefined) {
          clearTimerHandle(pettingHoldTimer)
          pettingHoldTimer = undefined
        }
        setEmotionWithEffect(Emotion.HAPPY)
        if (!pettingMotionActive) {
          pettingMotionActive = true
          const baseRotation = pettingPreviousRotation
          const yawAmount = randomInRange(Math.PI / 15, Math.PI / 10)
          const pitch = Math.max(-Math.PI / 4, baseRotation.p - randomInRange(Math.PI / 10, Math.PI / 8))
          const firstDirection = nextRandom() < 0.5 ? -1 : 1
          const upRotation = { ...baseRotation, p: pitch }
          const leftRight = (direction: number): Rotation => ({
            ...baseRotation,
            p: pitch,
            y: Math.max(-Math.PI / 6, Math.min(Math.PI / 6, baseRotation.y + direction * yawAmount)),
          })
          log(
            `[TouchPanel] pet motion shake yaw=${yawAmount.toFixed(3)} pitch=${pitch.toFixed(3)} direction=${firstDirection}\n`,
          )
          void runPettingMotion(upRotation, leftRight, firstDirection).catch((error) =>
            log(`[TouchPanel] pet motion rejected ${errorMessage(error)}\n`),
          )
        }
        pettingRestoreTimer = timer.set(() => {
          if (disposed) return
          const restoreEmotion =
            motionDetectRestoreTimer !== undefined
              ? (motionDetectEmotion ?? Emotion.NEUTRAL)
              : (pettingPreviousEmotion ?? Emotion.NEUTRAL)
          log(`[TouchPanel] restore emotion ${restoreEmotion}\n`)
          if (currentEmotion === Emotion.HAPPY) {
            setEmotionWithEffect(restoreEmotion)
          }
          if (pettingHoldTimer !== undefined) {
            clearTimerHandle(pettingHoldTimer)
            pettingHoldTimer = undefined
          }
          if (pettingPreviousRotation) {
            void runPettingRestoreMotion(pettingPreviousRotation).catch((error) =>
              log(`[TouchPanel] restore motion rejected ${errorMessage(error)}\n`),
            )
          }
          pettingPreviousEmotion = undefined
          pettingPreviousRotation = undefined
          pettingRestoreTimer = undefined
        }, TOUCH_PANEL_HAPPY_DURATION_MS)
        lastForwardSwipeTicks = undefined
        lastBackwardSwipeTicks = undefined
      }
    })
  }

  scope.own(() => {
    disposed = true
    clearTimerHandle(motionDetectRestoreTimer)
    motionDetectRestoreTimer = undefined
    clearTimerHandle(pettingRestoreTimer)
    pettingRestoreTimer = undefined
    clearTimerHandle(pettingHoldTimer)
    pettingHoldTimer = undefined
    motionDetectPreviousEmotion = undefined
    motionDetectEmotion = undefined
    pettingPreviousEmotion = undefined
    pettingPreviousRotation = undefined
    releasePettingTorque('cleanup')
    unsubscribeTouchPanel?.()
    if (deps.imu && deps.imu.onEvent === imuHandler) {
      deps.imu.onEvent = undefined
    }
    if (emoticonEffect !== null) {
      deps.removeEffect(emoticonEffect)
      emoticonEffect = null
    }
  })

  return ok(undefined)
}

export function createEmotionControlFeature<TDeps, TEffect = unknown>(
  selectDeps: (deps: TDeps) => EmotionControlDeps<TEffect>,
): ModFeature<TDeps, EmotionControlError> {
  return (deps, scope) => installEmotionControl(selectDeps(deps), scope)
}
