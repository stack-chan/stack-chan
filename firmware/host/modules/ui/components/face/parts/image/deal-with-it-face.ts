import { type FaceBaseParams, SimpleFace } from 'behaviors/face'

const glassesSkin = new Skin({ texture: { path: 'deal-with-it-eyes.png' }, width: 184, height: 40 })

export class DealWithItFace extends SimpleFace {
  constructor(params: FaceBaseParams = {}) {
    super(params)
    // Keep the actual SimpleFace mouth, layout and behavior; replace its eyes.
    for (let i = 0; i < 2; i++) {
      if (this.first) this.remove(this.first)
    }
    const glasses = new Content(null, { left: 8, top: 15, width: 184, height: 40, skin: glassesSkin })
    if (this.first) this.insert(glasses, this.first)
    else this.add(glasses)
  }
}
