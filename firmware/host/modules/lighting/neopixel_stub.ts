class NeoPixel {
  close() {}
  update() {}

  makeRGB(_r: number, _g: number, _b: number) {
    return 0
  }
  makeHSB(_h: number, _s: number, _b: number) {
    return 0
  }

  setPixel(_index: number, _color: number) {}
  fill(_color: number, _index: number, _count: number) {}
  getPixel(_index: number) {
    return 0
  }
  set brightness(_value: number) {}
  get brightness() {
    return 128
  }

  get length() {
    return 1
  }
  get byteLength() {
    return 1
  }
}
Object.freeze(NeoPixel.prototype)

export default NeoPixel
