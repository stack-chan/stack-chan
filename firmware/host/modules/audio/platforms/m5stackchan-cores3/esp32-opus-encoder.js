/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export function writePcmRing(data, state, src, offset, size, channels) {
  return native('xs_pcm_ring_write_downmix').call(this, data, state, src, offset, size, channels)
}

export default class extends Native('xs_esp32_opus_encoder_destructor') {
  constructor() {
    super()
    native('xs_esp32_opus_encoder_constructor').call(this)
  }

  close() {
    native('xs_esp32_opus_encoder_close').call(this)
  }

  attachPcmRing(data, state) {
    native('xs_esp32_opus_encoder_attach_pcm_ring').call(this, data, state)
  }

  read(output) {
    return native('xs_esp32_opus_encoder_read').call(this, output)
  }

  clear() {
    native('xs_esp32_opus_encoder_clear').call(this)
  }

  get capturedPcmBytes() {
    return native('xs_esp32_opus_encoder_captured_pcm_bytes').call(this)
  }

  get droppedPcmBytes() {
    return native('xs_esp32_opus_encoder_dropped_pcm_bytes').call(this)
  }
}
