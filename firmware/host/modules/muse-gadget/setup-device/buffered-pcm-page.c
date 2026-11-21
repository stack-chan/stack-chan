#include "xsmc.h"
#include "esp_heap_caps.h"
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#define PCM_PAGE_BYTES (16 * 1024)

void xs_pcm_page_destructor(void *data)
{
  if (!data) return;
  volatile uint8_t *bytes = data;
  for (unsigned index = 0; index < PCM_PAGE_BYTES; ++index) bytes[index] = 0;
  heap_caps_free(data);
}

void xs_pcm_page(xsMachine *the)
{
  void *data = heap_caps_malloc(PCM_PAGE_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!data) xsUnknownError("PCM buffer PSRAM unavailable");
  xsmcSetHostData(xsThis, data);
}

static void transfer(xsMachine *the, bool write)
{
  uint8_t *page = xsmcGetHostData(xsThis);
  const int bufferOffset = xsmcToInteger(xsArg(1));
  const int pageOffset = xsmcToInteger(xsArg(2));
  const int size = xsmcToInteger(xsArg(3));
  void *buffer;
  xsUnsignedValue length;
  if (write) xsmcGetBufferReadable(xsArg(0), &buffer, &length);
  else xsmcGetBufferWritable(xsArg(0), &buffer, &length);
  if (!page || bufferOffset < 0 || pageOffset < 0 || size < 0 || pageOffset > PCM_PAGE_BYTES ||
      size > PCM_PAGE_BYTES - pageOffset || (xsUnsignedValue)bufferOffset > length ||
      (xsUnsignedValue)size > length - (xsUnsignedValue)bufferOffset)
    xsRangeError("invalid PCM page transfer");
  if (write) memcpy(page + pageOffset, (uint8_t *)buffer + bufferOffset, size);
  else memcpy((uint8_t *)buffer + bufferOffset, page + pageOffset, size);
}

void xs_pcm_page_put(xsMachine *the)
{
  transfer(the, true);
}

void xs_pcm_page_get(xsMachine *the)
{
  transfer(the, false);
}

void xs_pcm_page_close(xsMachine *the)
{
  void *data = xsmcGetHostData(xsThis);
  xsmcSetHostData(xsThis, NULL);
  xs_pcm_page_destructor(data);
}
