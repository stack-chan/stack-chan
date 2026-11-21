#include "xsmc.h"
#include <stdint.h>

void xs_fixture_pcm_check(xsMachine *the) {
  void *data;
  xsUnsignedValue length;
  xsIntegerValue offset = xsmcToInteger(xsArg(1));
  xsmcGetBufferReadable(xsArg(0), &data, &length);
  if (offset < 0) { xsmcSetBoolean(xsResult, 0); return; }
  const uint8_t *bytes = data;
  uint32_t phase = ((uint32_t)offset) % 5760;
  for (xsUnsignedValue i = 0; i < length; i++) {
    if (bytes[i] != (uint8_t)phase) { xsmcSetBoolean(xsResult, 0); return; }
    if (++phase == 5760) phase = 0;
  }
  xsmcSetBoolean(xsResult, 1);
}
