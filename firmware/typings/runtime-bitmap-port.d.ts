declare module 'runtime-bitmap-port' {
  import type { Port } from 'piu/MC'
  import type Bitmap from 'commodetto/Bitmap'

  export default class RuntimeBitmapPort extends Port {
    drawBitmap(bitmap: Bitmap, x: number, y: number, sx?: number, sy?: number, sw?: number, sh?: number): void
  }
}
