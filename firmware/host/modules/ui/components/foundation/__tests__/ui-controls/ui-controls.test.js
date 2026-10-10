import { Application, Container, Skin } from 'piu/MC'
import { assert as check } from 'testing/assert'
import {
  ActionButton,
  IconView,
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
        setActionButtonEnabled(button, false)
        check(!button.active, 'disabled button should not be active')
        button.behavior.onTouchBegan(button, 0, 21, 21)
        button.behavior.onTouchEnded(button)
        check(taps === 1, 'disabled button must not activate')
      } else if (step === 2) {
        setActionButtonEnabled(button, true)
        setActionButtonSelected(button, true)
        check(button.active, 're-enabled button should be active')
      } else {
        app.stop()
        trace('RENDER COMPLETE\n')
        trace('ok\n')
      }
      step++
    }
  },
})
