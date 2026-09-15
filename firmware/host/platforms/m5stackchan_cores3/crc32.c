// Standard reflected CRC-32 (IEEE), using the ESP32 ROM implementation.
#include "xsHost.h"
#include "xsmc.h"
#include "esp_rom_crc.h"

void xs_stackchan_crc32(xsMachine *the) {
  void *bytes;
  xsUnsignedValue length;
  xsmcGetBufferReadable(xsArg(0), &bytes, &length);
  xsmcSetNumber(xsResult, esp_rom_crc32_le(0, bytes, length));
}
