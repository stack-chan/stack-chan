#include "xsmc.h"
#include <stdint.h>
#include <string.h>

void xs_gemini_worker_find_lf(xsMachine *the) {
  void *data;
  xsUnsignedValue size;
  xsIntegerValue offset = xsmcToInteger(xsArg(1));
  xsmcGetBufferReadable(xsArg(0), &data, &size);
  if ((offset < 0) || ((xsUnsignedValue)offset >= size)) {
    xsmcSetInteger(xsResult, -1);
    return;
  }
  const uint8_t *start = (const uint8_t *)data;
  const uint8_t *lf = memchr(start + offset, '\n', size - (xsUnsignedValue)offset);
  xsmcSetInteger(xsResult, lf ? (xsIntegerValue)(lf - start) : -1);
}
