import { scan } from 'mp3-frames'

/**
 * MP3 frame decoder backed by Espressif's ESP32-S3 optimized audio codec.
 *
 * The public shape intentionally matches Moddable's mp3/decode module so the
 * existing MP3 streamers can use this implementation without special cases.
 */
export default class extends Native('xs_esp32_mp3_destructor') {
  constructor() {
    super()
    native('xs_esp32_mp3_constructor').call(this)
  }

  close() {
    return native('xs_esp32_mp3_close').call(this)
  }

  decode(input, output) {
    return native('xs_esp32_mp3_decode').call(this, input, output)
  }

  static scan(buffer, start, end, info) {
    return scan(buffer, start, end, info)
  }

  // The Espressif decoder consumes an exact MP3 frame and does not require
  // libmad's eight trailing guard bytes.
  static BUFFER_GUARD = 0
}
