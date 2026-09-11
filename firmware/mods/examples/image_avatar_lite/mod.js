import { defineApp, EMOTIONS } from 'stackchan'
import { ui } from 'stackchan/extensions/ui'
import { IMAGE_AVATAR_LITE_PACKS } from './image-avatar-lite-packs.js'

export default defineApp({
  setup(app) {
    const view = ui(app)
    const packs = Object.values(IMAGE_AVATAR_LITE_PACKS)
    let selected = 0
    let emotion = 0
    /** @param {string} id */
    const showPack = (id) => {
      const pack = IMAGE_AVATAR_LITE_PACKS[id]
      view.setImageAvatar(pack)
      selected = packs.indexOf(pack)
    }
    showPack('image-avatar-lite-slime')
    const control = view.addChoice(
      {
        id: 'avatar',
        label: '画像アバター',
        value: packs[selected].id,
        options: packs.map((pack) => ({ value: pack.id, label: pack.displayName })),
      },
      showPack,
    )
    app.input.onPress('primary', () => {
      const pack = packs[(selected + 1) % packs.length]
      showPack(pack.id)
      control.setValue(pack.id)
    })
    view.addAction({ id: 'avatar-emotion', label: '表情を変える' }, () => {
      emotion = (emotion + 1) % EMOTIONS.length
      app.face.setEmotion(EMOTIONS[emotion])
    })
  },
})
