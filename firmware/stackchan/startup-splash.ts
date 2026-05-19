import { Application, Content, Skin, Texture } from 'piu/MC'
import type { Skin as PiuSkin, Texture as PiuTexture } from 'piu/MC'

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

export function showStartupSplash() {
  new Application(null, {
    displayListLength: 8192,
    touchCount: 0,
    contents: [
      new Content(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: getSplashSkin(),
      }),
    ],
  })
}
