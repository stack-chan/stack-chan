import { ImageAvatarFace } from 'parts/image/image-avatar-face'
import { registerUIFactory } from 'stackchan-factory-registry'
import { asStackchanUIOptions, createRegisteredStackchanUI } from 'stackchan-factory-registry/ui'

registerUIFactory('image', (param) => {
  const options = asStackchanUIOptions(param)
  return createRegisteredStackchanUI(
    new ImageAvatarFace({ pack: options.avatar }),
    options,
    options.displayListLength ?? 4096,
  )
})
