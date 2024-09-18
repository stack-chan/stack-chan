import config from 'mc/config'
import Timer from 'timer'
import Time from 'time'

export default class Touch {
  onTouchBegan: (x: number, y: number, ticks: number) => void
  onTouchMoved: (x: number, y: number, ticks: number) => void
  onTouchEnded: (x: number, y: number, ticks: number) => void

  constructor() {
    const touch = new config.Touch()
    touch.points = [{}]

    Timer.repeat(() => {
      const points = touch.points
      touch.read(points)
      const point = points[0]
      switch (point.state) {
        case 0:
        case 3:
          if (point.down) {
            point.down = undefined
            this.onTouchEnded?.(point.x, point.y, Time.ticks)
            point.x = undefined
            point.y = undefined
          }
          break
        case 1:
        case 2:
          if (!point.down) {
            point.down = true
            this.onTouchBegan?.(point.x, point.y, Time.ticks)
          } else this.onTouchMoved?.(point.x, point.y, Time.ticks)
          break
      }
    }, 15)
  }
}
