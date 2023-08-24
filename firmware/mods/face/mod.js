// import { Renderer } from 'simple-face'
import { Renderer } from 'dog-face'
import { useRenderBalloon } from 'effects'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import Timer from 'timer'
const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))

function hsl2rgbaux(v1, v2, vH) {
  if (vH < 0) vH += 1
  if (vH > 1) vH -= 1
  if (6 * vH < 1) return v1 + (v2 - v1) * 6 * vH
  if (2 * vH < 1) return v2
  if (3 * vH < 2) return v1 + (v2 - v1) * (2.0 / 3 - vH) * 6
  return v1
}

function hsl2rgb(H, S, L) {
  if (S < 0) S = 0
  else if (S > 1) S = 1
  if (L < 0) L = 0
  else if (L > 1) L = 1
  if (S == 0) {
    return [L * 255, L * 255, L * 255]
  } else {
    let v1, v2
    H = Math.mod(H, 360)
    if (H < 0) H += 360
    H /= 360
    v2 = L < 0.5 ? L * (1 + S) : L + S - L * S
    v1 = 2 * L - v2
    return [255 * hsl2rgbaux(v1, v2, H + 1.0 / 3), 255 * hsl2rgbaux(v1, v2, H), 255 * hsl2rgbaux(v1, v2, H - 1.0 / 3)]
  }
}

const balloon = useRenderBalloon({
  right: 20,
  top: 10,
  width: 80,
  height: font.height,
  font,
  // text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  text: 'thinking......',
})

export function onRobotCreated(robot) {
  robot.useRenderer(new Renderer())
  robot.renderer.addEffect(balloon)
  robot.setColor('primary', 0x22, 0x22, 0x22)
  let flag = false
  Timer.repeat(() => {
    if (flag) {
      robot.renderer.addEffect(balloon)
      robot.setEmotion('ANGRY')
    } else {
      robot.renderer.removeEffect(balloon)
      robot.setEmotion('SAD')
    }
    flag = !flag
  }, 3000)

  let count = 0
  Timer.repeat(() => {
    robot.setColor('secondary', ...hsl2rgb(count, 1, 0.5))
    count = (count + 10) % 360
  }, 200)
}
