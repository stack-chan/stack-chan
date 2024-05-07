import type { StackchanMod } from 'default-mods/mod'
import Timer from 'timer'
import { randomBetween, asyncWait } from 'stackchan-util'
import KeyboardService from 'keyboardService'

const FORWARD = {
  y: 0,
  p: 0,
  r: 0,
}
const LEFT = {
  ...FORWARD,
  y: Math.PI / 6,
}
const RIGHT = {
  ...FORWARD,
  y: -Math.PI / 6,
}
const DOWN = {
  ...FORWARD,
  p: Math.PI / 32,
}
const UP = {
  ...FORWARD,
  p: -Math.PI / 6,
}

const VOICE_NEXT = ['next1', 'next2', 'next3', 'next4', 'dondon', 'ok']
const VOICE_PREVIOUS = ['previous1', 'previous2', 'chotto']

type TouchEvent = 'SwipeUp' | 'SwipeRight' | 'SwipeDown' | 'SwipeLeft' | 'Press'

function getRandomItem<T = unknown>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export const onRobotCreated: StackchanMod['onRobotCreated'] = (robot) => {
  const keyboardService = new KeyboardService({
    onKeyboardBound: () => {
      trace('keyboard connected\n')
    },
    onKeyboardUnbound: () => {
      trace('keyboard disconnected\n')
    },
  })

  const handleTouch = (event: TouchEvent) => {
    trace(event + ' triggered\n')
    switch (event) {
      case 'SwipeUp':
        keyboardService.onKeyTap({ character: 'Up' })
        break
      case 'SwipeRight':
        robot.say(getRandomItem(VOICE_NEXT))
        keyboardService.onKeyTap({ character: 'Right' })
        break
      case 'SwipeDown':
        keyboardService.onKeyTap({ character: 'Down' })
        break
      case 'SwipeLeft':
        robot.say(getRandomItem(VOICE_PREVIOUS))
        keyboardService.onKeyTap({ character: 'Left' })
        break
      case 'Press':
        keyboardService.onKeyTap({ character: 'Enter' })
        break
      default:
      /* noop */
    }
  }

  let startX: number
  let startY: number
  const SWIPE_THRESHOLD = 30
  if (robot.touch != null) {
    robot.touch.onTouchBegan = (x, y, ticks) => {
      startX = x
      startY = y
      trace(`BEGAN ... x: ${x}, y: ${y}, ticks: ${ticks}\n`)
    }
    robot.touch.onTouchMoved = (x, y, ticks) => {
      trace(`MOVED ... x: ${x}, y: ${y}, ticks: ${ticks}\n`)
    }
    robot.touch.onTouchEnded = (x, y, ticks) => {
      const dx = x - startX
      const dy = y - startY
      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
        handleTouch('Press')
      } else if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        handleTouch(dx > 0 ? 'SwipeRight' : 'SwipeLeft')
      } else {
        handleTouch(dy > 0 ? 'SwipeDown' : 'SwipeUp')
      }
      trace(`ENDED ... x: ${x}, y: ${y}, ticks: ${ticks}\n`)
    }
  }

  if (robot.button != null) {
    robot.button.a.onChanged = async function () {
      if (this.read()) {
        handleTouch('SwipeLeft')
      }
    }
    robot.button.c.onChanged = async function () {
      if (this.read()) {
        handleTouch('SwipeLeft')
      }
    }
  }
}
