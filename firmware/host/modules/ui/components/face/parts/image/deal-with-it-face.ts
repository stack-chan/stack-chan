import { type FaceBaseParams, SimpleFace } from 'behaviors/face'

const glassesSkin = new Skin({ texture: { path: 'deal-with-it-eyes.png' }, width: 214, height: 40 })

export class DealWithItFace extends SimpleFace {
  constructor(params: FaceBaseParams = {}) {
    // Expand symmetrically so the full texture fits the existing FaceView clip.
    // The mouth's screen position stays identical to SimpleFace.
    super({ ...params, left: (params.left ?? 60) - 7, width: (params.width ?? 200) + 14 })
    if (this.behavior) Object.assign(this.behavior, { preservePositionOnSwap: false })
    // Keep the actual SimpleFace mouth, layout and behavior; replace its eyes.
    for (let i = 0; i < 2; i++) {
      if (this.first) this.remove(this.first)
    }
    const glasses = new Content(null, { left: 0, top: 15, width: 214, height: 40, skin: glassesSkin })
    if (this.first) {
      const mouth = this.first
      mouth.coordinates = { ...mouth.coordinates, left: (mouth.coordinates.left ?? 0) + 7 }
      this.insert(glasses, mouth)
    } else this.add(glasses)
  }
}
