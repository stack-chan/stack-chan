const MPEG1_LAYER1_RATES = Object.freeze([0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448])
const MPEG1_LAYER2_RATES = Object.freeze([0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384])
const MPEG1_LAYER3_RATES = Object.freeze([0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320])
const MPEG2_LAYER1_RATES = Object.freeze([0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256])
const MPEG2_LAYER23_RATES = Object.freeze([0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])
const SAMPLE_RATES = Object.freeze([
  Object.freeze([11025, 12000, 8000]),
  Object.freeze([]),
  Object.freeze([22050, 24000, 16000]),
  Object.freeze([44100, 48000, 32000]),
])

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

  static scan(buffer, start, end, info = {}) {
    const position = findFrame(buffer, start, end, info)
    if (position === undefined) return

    info.position = position
    if (info.length === 0) {
      const next = findFrame(buffer, position + 1, end)
      if (next !== undefined) info.length = next - position
      else {
        if (end - start >= 2048) return
        info.length = 2048
      }
    }
    return info
  }

  // The Espressif decoder consumes an exact MP3 frame and does not require
  // libmad's eight trailing guard bytes.
  static BUFFER_GUARD = 0
}

function findFrame(buffer, position, end, info) {
  while (position < end) {
    position = buffer.indexOf(0xff, position)
    if (position < 0 || position + 4 > end) return

    const second = buffer[position + 1]
    if ((second & 0xe0) !== 0xe0) {
      position += 1
      continue
    }

    const version = (second >> 3) & 3
    const layer = (second >> 1) & 3
    if (version === 1 || layer === 0) {
      position += 1
      continue
    }

    const third = buffer[position + 2]
    const bitRateIndex = third >> 4
    const sampleRateIndex = (third >> 2) & 3
    if (bitRateIndex === 15 || sampleRateIndex === 3) {
      position += 1
      continue
    }

    const sampleRate = SAMPLE_RATES[version][sampleRateIndex]
    const rates =
      version === 3
        ? layer === 3
          ? MPEG1_LAYER1_RATES
          : layer === 2
            ? MPEG1_LAYER2_RATES
            : MPEG1_LAYER3_RATES
        : layer === 3
          ? MPEG2_LAYER1_RATES
          : MPEG2_LAYER23_RATES
    const bitRate = rates[bitRateIndex]
    const padded = (third >> 1) & 1
    let length = 0
    const samples = layer === 3 ? 384 : layer === 2 || version === 3 ? 1152 : 576
    if (bitRate) {
      if (layer === 3) length = (Math.idiv(12 * bitRate * 1000, sampleRate) + padded) * 4
      else {
        const coefficient = layer === 1 && version !== 3 ? 72 : 144
        length = Math.idiv(coefficient * bitRate * 1000, sampleRate) + padded
      }
    }

    if (info) {
      info.length = length
      info.sampleRate = sampleRate
      info.bitRate = bitRate * 1000
      info.samples = samples
      info.channels = buffer[position + 3] >> 6 === 3 ? 1 : 2
    }
    return position
  }
}
