import { Application, Container, Skin } from 'piu/MC'
import { assert as check } from 'testing/assert'
import {
  ActionButton,
  IconView,
  ScreenHeader,
  setActionButtonEnabled,
  setActionButtonLabel,
  setActionButtonSelected,
} from 'ui-controls'
import { UI } from 'ui-theme'

const icons = [
  'apps',
  'back',
  'camera',
  'check',
  'close',
  'clock',
  'language',
  'menu',
  'microphone',
  'offline',
  'palette',
  'play',
  'retry',
  'scan',
  'settings',
  'volume',
  'wifi',
]
const grid = new Container(null, {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  contents: icons.flatMap((icon, index) => [
    new IconView({ icon, enabled: true }, { left: 16 + (index % 8) * 36, top: 8 + Math.floor(index / 8) * 36 }),
    new IconView({ icon, enabled: false }, { left: 16 + (index % 8) * 36, top: 120 + Math.floor(index / 8) * 36 }),
  ]),
})
let taps = 0
const button = new ActionButton(
  {
    icon: 'wifi',
    label: 'Wi-Fi',
    onTap() {
      taps++
    },
  },
  { left: 20, top: 20, width: 140 },
)
const smallIcon = new IconView({ icon: 'check', enabled: true }, { left: 190, top: 28, width: 24, height: 24 })
let rowTaps = 0
let backTaps = 0
const row = new ActionButton(
  {
    icon: 'wifi',
    label: 'List item',
    appearance: 'row',
    onTap() {
      rowTaps++
    },
  },
  { left: 20, top: 100, width: 280 },
)
const header = new ScreenHeader(
  {
    title: 'AppBar',
    leading: 'back',
    onLeading() {
      backTaps++
    },
  },
  { top: 164 },
)
let step = 0
export default new Application(null, {
  displayListLength: 16384,
  commandListLength: 16384,
  skin: new Skin({ fill: UI.colors.background }),
  contents: [grid],
  Behavior: class extends Behavior {
    onDisplaying(app) {
      app.interval = 100
      app.start()
    }
    onTimeChanged(app) {
      if (step === 0) {
        app.empty()
        app.add(button)
        app.add(smallIcon)
        app.add(row)
        app.add(header)
        const rb = row.behavior
        rb.onTouchBegan(row, 0, 21, 101)
        rb.onTouchEnded(row)
        check(rowTaps === 1, 'row tap must dispatch once')
        rb.onTouchBegan(row, 0, 21, 101)
        rb.onTouchMoved(row, 0, 21, 111)
        rb.onTouchEnded(row)
        rb.onTouchBegan(row, 0, 21, 101)
        rb.onTouchCancelled(row)
        check(rowTaps === 1, 'row drag or cancel must not activate')
        const back = header.first
        check(back.y === header.y && back.height === header.height, 'back must fit inside the header')
        const backIcon = back.content('icon')
        check(backIcon.y - back.y === (back.height - backIcon.height) / 2, 'back icon must be centered vertically')
        check(
          app.hit(back.x + back.width / 2, back.y + back.height / 2) === back,
          'back icon must not intercept touches',
        )
        back.behavior.onTouchBegan(back, 0, 16, 184)
        back.behavior.onTouchEnded(back)
        check(backTaps === 1, 'header back must dispatch once')
        check(button.width === 140 && button.height === UI.touchTarget, 'button bounds changed')
        const b = button.behavior
        b.onTouchBegan(button, 0, 21, 21)
        b.onTouchEnded(button)
        check(taps === 1, 'tap must dispatch once')
        b.onTouchBegan(button, 0, 21, 21)
        b.onTouchMoved(button, 0, 21, 31)
        b.onTouchEnded(button)
        check(taps === 1, 'scroller drag must not activate a button')
        b.onTouchBegan(button, 0, 21, 21)
        b.onTouchCancelled(button)
        check(taps === 1, 'cancel must not activate a button')
        setActionButtonLabel(button, 'Wi-Fi ready')
        check(button.content('label').string === 'Wi-Fi ready', 'label update was lost')
        trace('TOUCH PASS\n')
      } else if (step === 1) {
        row.behavior.onTouchBegan(row, 0, 21, 101)
      } else if (step === 2) {
        row.behavior.onTouchCancelled(row)
        setActionButtonEnabled(row, false)
        check(!row.active, 'disabled row must reject input')
        row.behavior.onTouchBegan(row, 0, 21, 101)
        row.behavior.onTouchEnded(row)
        check(rowTaps === 1, 'disabled row must not activate')
        setActionButtonEnabled(button, false)
        check(!button.active, 'disabled button should not be active')
        button.behavior.onTouchBegan(button, 0, 21, 21)
        button.behavior.onTouchEnded(button)
        check(taps === 1, 'disabled button must not activate')
      } else if (step === 3) {
        setActionButtonEnabled(row, true)
        setActionButtonSelected(row, true)
        check(row.active, 're-enabled row must accept input')
        setActionButtonEnabled(button, true)
        setActionButtonSelected(button, true)
        check(button.active, 're-enabled button should be active')
      } else {
        app.stop()
        trace('RENDER COMPLETE\n')
        trace('ok\n')
        trace('@@STACKCHAN_TEST:PASS@@\n')
      }
      step++
    }
  },
})
