import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import { getImageAvatarLitePack } from './image-avatar-lite-packs'

export function onRobotCreated(robot) {
  robot.renderer?.setFace?.(new ImageAvatarFace({ pack: getImageAvatarLitePack() }))
}
