import { onContextCreated as runDefaultBehavior } from 'app-default-behavior/on-context-created'
import { Emotion } from 'face-state'
import Timer from 'timer'

const SAD_DURATION_MS = 3000
const LED_NAME = 'head'
const LED_LEVEL = 48
const SAD_COLOR = { r: LED_LEVEL, g: 0, b: 0 }
const HAPPY_COLOR = { r: 0, g: LED_LEVEL, b: 0 }

// 既定動作(app-default-behavior/on-context-created)の撫で判定に合わせた値。
// ここがずれるとLEDと表情の残り時間が食い違う。
const PETTING_WINDOW_MS = 1500
const HAPPY_DURATION_MS = 5000

export function onContextCreated(robot, option) {
  // MODのonContextCreatedは既定動作を上書きするため、明示的に呼んで残す。
  // 撫でたときにHAPPYにするのも、ボタンやIMUの転倒検出も既定動作側の担当。
  runDefaultBehavior(robot, option)

  const touchPanel = robot.input?.touchPanel ?? robot.touchPanel
  if (touchPanel == null) {
    trace('[head-tap-sad] touch panel unavailable\n')
    return
  }

  const led = createLed(robot)
  const sad = createSadFace(robot, led)
  const petting = createPettingWatcher(led)

  touchPanel.subscribe((event) => {
    if (event.gesture === 'forwardSwipe' || event.gesture === 'backwardSwipe') {
      petting.onSwipe(event)
      return
    }
    // tapを伴うreleaseだけが「叩いた」。
    // 撫でるとswipeを経由してSWIPING状態に入り、releaseにtapが付かない。
    if (event.gesture !== 'release' || event.tap === undefined) {
      return
    }
    trace(`[head-tap-sad] tap duration=${event.tap.durationMs}ms position=${event.tap.position}\n`)
    sad.show(event.ticks)
  })

  trace('[head-tap-sad] ready\n')
}

// 表情の状態はhost側から読めない(runtime-contextはpreloadで凍結されていて差し替えもできない)ため、
// LEDはMOD側で持つ。点灯要求ごとに期限を貼り直し、最後の要求が勝つ。
function createLed(robot) {
  let offTimer

  return {
    show(color, durationMs) {
      if (offTimer !== undefined) {
        Timer.clear(offTimer)
      }
      robot.lighting.lightOn(LED_NAME, color.r, color.g, color.b)
      offTimer = Timer.set(() => {
        offTimer = undefined
        robot.lighting.lightOff(LED_NAME)
      }, durationMs)
    },
  }
}

function createSadFace(robot, led) {
  // 期限で管理する。連打されても悲しい顔に入る瞬間しかsetEmotionを呼ばないので
  // 表情がチラつかず、最後に叩かれた時点から3秒後に戻る。
  let sadUntil = 0
  let restoreTimer

  function restoreNeutral() {
    restoreTimer = undefined
    sadUntil = 0
    trace('[head-tap-sad] restore NEUTRAL\n')
    robot.face.setEmotion(Emotion.NEUTRAL)
  }

  return {
    show(ticks) {
      if (sadUntil === 0) {
        trace('[head-tap-sad] set SAD\n')
        robot.face.setEmotion(Emotion.SAD)
      }
      sadUntil = ticks + SAD_DURATION_MS
      led.show(SAD_COLOR, SAD_DURATION_MS)
      if (restoreTimer !== undefined) {
        Timer.clear(restoreTimer)
      }
      restoreTimer = Timer.set(restoreNeutral, SAD_DURATION_MS)
    },
  }
}

// 撫でるとHAPPYにするのは既定動作の担当だが、その表情変化をMODから観測できない。
// 同じ条件(前後のswipeが1500ms以内に揃う)を並行して見て、LEDだけ合わせる。
function createPettingWatcher(led) {
  let lastForwardTicks
  let lastBackwardTicks

  return {
    onSwipe(event) {
      if (event.gesture === 'forwardSwipe') {
        lastForwardTicks = event.ticks
      } else {
        lastBackwardTicks = event.ticks
      }

      const hasForward = lastForwardTicks !== undefined && event.ticks - lastForwardTicks <= PETTING_WINDOW_MS
      const hasBackward = lastBackwardTicks !== undefined && event.ticks - lastBackwardTicks <= PETTING_WINDOW_MS
      if (!hasForward || !hasBackward) {
        return
      }
      trace('[head-tap-sad] petting detected\n')
      led.show(HAPPY_COLOR, HAPPY_DURATION_MS)
    },
  }
}
