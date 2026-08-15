/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export default class extends Native('xs_esp32_opus_encoder_destructor') {
  constructor() {
    super()
    native('xs_esp32_opus_encoder_constructor').call(this)
  }

  close() {
    native('xs_esp32_opus_encoder_close').call(this)
  }

  encode(input, output) {
    return native('xs_esp32_opus_encode').call(this, input, output)
  }
}
