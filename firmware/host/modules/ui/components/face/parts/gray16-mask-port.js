import { Port, Template } from 'piu/MC'

const drawGrayNative = native('xs_stackchan_gray16_mask_port_draw')

const Gray16MaskPort = Template(
  Object.freeze({
    __proto__: Port.prototype,
    drawGray(mask, color) {
      this._gray16Bitmap = mask.bitmap
      this._gray16Bytes = mask.bytes
      this._gray16Color = color
      drawGrayNative.call(this, mask.width, mask.height)
    },
  }),
)

export default Gray16MaskPort
