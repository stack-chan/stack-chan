import { type FaceBaseParams, SimpleFace } from 'behaviors/face'

export class DealWithItFace extends SimpleFace {
  constructor(params: FaceBaseParams = {}) {
    // Expand symmetrically so the full texture fits the existing FaceView clip.
    // The mouth's screen position stays identical to SimpleFace.
    super({ ...params, left: (params.left ?? 60) - 26, width: (params.width ?? 200) + 52 })
    if (this.behavior) Object.assign(this.behavior, { preservePositionOnSwap: false })
    // Keep the actual SimpleFace mouth, layout and behavior; replace its eyes.
    for (let i = 0; i < 2; i++) {
      if (this.first) this.remove(this.first)
    }
    // Texture-backed skins must be created at runtime, after WASM preloading.
    const glassesSkin = new Skin({ texture: { path: 'deal-with-it-eyes.png' }, width: 252, height: 52 })
    const glasses = new Content(null, { left: 0, top: 7, width: 252, height: 52, skin: glassesSkin })
    if (this.first) {
      const mouth = this.first
      mouth.coordinates = { ...mouth.coordinates, left: (mouth.coordinates.left ?? 0) + 26 }
      this.insert(glasses, mouth)
    } else this.add(glasses)
  }
}
