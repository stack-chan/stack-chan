import { Application, Content, Skin, Texture } from 'piu/MC'
import type {
  Application as PiuApplication,
  Content as PiuContent,
  Skin as PiuSkin,
  Texture as PiuTexture,
} from 'piu/MC'

export type StartupSplashOptions = {
  onTouch?: () => void
}

let splashTexture: PiuTexture | null = null
let splashSkin: PiuSkin | null = null

function getSplashSkin() {
  if (!splashTexture) splashTexture = new Texture('startup-splash.png')
  if (!splashSkin) {
    splashSkin = new Skin({
      texture: splashTexture,
      width: 320,
      height: 240,
    })
  }
  return splashSkin
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  return new Application(options, {
    displayListLength: 8192,
    touchCount: 1,
    contents: [
      new Content(options, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        active: true,
        skin: getSplashSkin(),
        Behavior: class extends Behavior {
          options: StartupSplashOptions | null = null

          onCreate(_content: PiuContent, data: StartupSplashOptions) {
            this.options = data
          }

          onTouchBegan(_content: PiuContent) {
            this.options?.onTouch?.()
          }
        },
      }),
    ],
  })
}
