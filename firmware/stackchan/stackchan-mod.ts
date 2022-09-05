import Avatar from 'avatar'
import { hsl } from 'piu/All'
import CombTransition from 'piu/CombTransition'
import { Application, Color, Content } from 'piu/MC'
import { Robot, Target } from 'robot'
import Timer from 'timer'

export interface StackchanMod {
  onLaunch?: () => Application
  onApplicationCreated?: (application: Application) => void
  onButtonChange?: (buttonName: 'A' | 'B' | 'C', pressed: boolean) => void
  onRobotCreated?: (robot: Robot) => void
  autoLoop?: boolean
}

// TODO: move file local variables to context hooks
let ap: Application
let avatar: Content
let robot: Robot
let target: Target
let isFollowing: boolean = false

function createAvatar(primaryColor: Color, secondaryColor: Color) {
  return new Avatar({
    width: 320,
    height: 240,
    name: 'avatar',
    primaryColor,
    secondaryColor,
    props: {
      autoUpdateGaze: false,
    },
  })
}

function swapFace(primaryColor, secondaryColor) {
  const av = createAvatar(primaryColor, secondaryColor)
  const transition = new CombTransition(250, Math.quadEaseOut, "horizontal", 4);
  ap.run(transition, ap.content("avatar"), av);
}

function onLaunch() {
  avatar = createAvatar('white', 'black')
  const contents = [avatar]
  ap = new Application(null, {
    displayListLength: 4096,
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    skin: new Skin({ fill: 'white' }),
    contents,
  })
  return ap
}

function onApplicationCreated() {
  /* do nothing */
}

function randomBetween(low: number, high: number): number {
  return Math.random() * (high - low) + low
}

function onRobotCreated(r) {
  robot = r
  target = new Target(0.1, 0.0, -0.03)
  robot.follow(target)

  const targetLoop = () => {
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    if (target != null) {
      trace(`looking at: (${x}, ${y}, ${z})\n`)
      target.x = x
      target.y = y
      target.z = z
    }
  }
  Timer.repeat(targetLoop, 5000)
}

function onButtonChange(button, isPressed) {
  if (!isPressed) {
    return
  }
  switch (button) {
    case 'A':
      isFollowing = !isFollowing
      if (isFollowing) {
        robot.follow(target)
      } else {
        robot.unfollow()
      }
      break
    case 'B':
      const primaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      const secondaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      swapFace(primaryColor, secondaryColor)
      break
    case 'C':
      /* noop */
      break
  }
}

export const defaultMod: StackchanMod = {
  onLaunch,
  onApplicationCreated,
  onRobotCreated,
  onButtonChange,
}
