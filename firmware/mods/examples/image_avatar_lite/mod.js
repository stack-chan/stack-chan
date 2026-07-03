import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import { registerImageAvatarPacks } from 'parts/image/image-avatar-pack'
import { IMAGE_AVATAR_LITE_PACKS } from './image-avatar-lite-packs'

export function onContextCreated(robot) {
  registerImageAvatarPacks(IMAGE_AVATAR_LITE_PACKS)
  robot.ui.setFace(new ImageAvatarFace({ pack: 'image-avatar-lite-slime' }))
}
