import { Port } from 'piu/MC'

const drawNative = native('xs_stackchan_runtime_bitmap_port_draw')

export default class RuntimeBitmapPort extends Port {
  drawBitmap(bitmap, x, y, sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height) {
    this._runtimeBitmap = bitmap
    this._runtimeBitmapSX = sx
    this._runtimeBitmapSY = sy
    this._runtimeBitmapSW = sw
    this._runtimeBitmapSH = sh
    drawNative.call(this, x, y, sx, sy, sw, sh)
  }
}
