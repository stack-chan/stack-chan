// Reuse Espressif's OS adapter, configuring the CoreS3 decoder without SDK edits.
// Install it after the default adapters. No SDK or managed component is modified.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/idf_additions.h"
#include "esp_heap_caps.h"
#include <string.h>

static BaseType_t stackchanMediaCreate(TaskFunction_t body, const char *name,
    uint32_t stackSize, void *arg, UBaseType_t priority, TaskHandle_t *handle,
    BaseType_t core, UBaseType_t caps) {
  // Measured decoder high-water use is 11.8 KB. Keep 4 KB of margin while
  // avoiding a hot codec stack competing with XS and graphics in PSRAM.
  if (!strcmp(name, "Adec")) {
    // LOWDELAY encoding leaves room on core 1 for decoding. Keep the UI
    // on core 0 and preserve the SDK audio priorities.
    core = 1;
    stackSize = 16 * 1024;
    caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
  }
  return xTaskCreatePinnedToCoreWithCaps(body, name, stackSize, arg, priority, handle, core, caps);
}
#define media_lib_add_default_os_adapter stackchanMediaAdapter
#define xTaskCreatePinnedToCoreWithCaps stackchanMediaCreate
// Resolved relative to media_lib_sal/include, supplied by its IDF component.
#include "../port/media_lib_os_freertos.c"
#undef xTaskCreatePinnedToCoreWithCaps

#undef media_lib_add_default_os_adapter
