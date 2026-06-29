import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import { getImageAvatarLitePack } from './image-avatar-lite-packs'

export function onContextCreated(robot) {
  robot.ui.setFace(new ImageAvatarFace({ pack: getImageAvatarLitePack() }))
}
