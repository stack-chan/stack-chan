/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export default class extends Native('xs_esp32_opus_destructor') {
  constructor(sampleRate, frameDuration) {
    super()
    native('xs_esp32_opus_constructor').call(this, sampleRate, frameDuration)
  }

  close() {
    native('xs_esp32_opus_close').call(this)
  }

  decode(input, output) {
    return native('xs_esp32_opus_decode').call(this, input, output)
  }
}
