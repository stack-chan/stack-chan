import { onContextCreated as runDefaultBehavior } from 'app-default-behavior/on-context-created'
import { Emotion } from 'face-state'
import Timer from 'timer'

const SAD_DURATION_MS = 3000

export function onContextCreated(robot, option) {
  // MODのonContextCreatedは既定動作を上書きするため、明示的に呼んで残す。
  // 撫でる(swipe)への反応、ボタン、IMUの転倒検出は既定動作側の担当。
  runDefaultBehavior(robot, option)

  const touchPanel = robot.input?.touchPanel ?? robot.touchPanel
  if (touchPanel == null) {
    trace('[head-tap-sad] touch panel unavailable\n')
    return
  }

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

  function showSad(ticks) {
    if (sadUntil === 0) {
      trace('[head-tap-sad] set SAD\n')
      robot.face.setEmotion(Emotion.SAD)
    }
    sadUntil = ticks + SAD_DURATION_MS
    if (restoreTimer !== undefined) {
      Timer.clear(restoreTimer)
    }
    restoreTimer = Timer.set(restoreNeutral, SAD_DURATION_MS)
  }

  touchPanel.subscribe((event) => {
    // tapを伴うreleaseだけが「叩いた」。
    // 撫でるとswipeを経由してSWIPING状態に入り、releaseにtapが付かない。
    // 撫でたときにHAPPYにするのは既定動作の担当なので、ここでは拾わない。
    if (event.gesture !== 'release' || event.tap === undefined) {
      return
    }
    trace(`[head-tap-sad] tap duration=${event.tap.durationMs}ms position=${event.tap.position}\n`)
    showSad(event.ticks)
  })

  trace('[head-tap-sad] ready\n')
}
