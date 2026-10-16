// SPDX-License-Identifier: Apache-2.0
import Screen from 'ili9341'

export default class StackchanScreen extends Screen {
  pixels(requested) {
    const width = this.width
    // Two fixed eight-row buffers retain Poco's asynchronous double buffering.
    // Batch raster/send callbacks without changing pixels, SPI speed or cadence.
    // Explicit Piu/Poco buffer requests keep their existing override semantics.
    return requested >= width ? requested : width * 16
  }
}
