export type ImageFormat = 'rgb565le' | 'rgb565be' | 'jpeg'
/** An owned copy. No native frame handle or manual device cleanup escapes into an app. */
export type CameraImage = Readonly<{
  width: number
  height: number
  format: ImageFormat
  source: 'native' | 'simulated'
  data: ArrayBuffer
}>
