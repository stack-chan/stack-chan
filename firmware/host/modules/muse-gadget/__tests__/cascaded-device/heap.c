#include "xsmc.h"
#include "esp_heap_caps.h"
void xs_test_internal_free(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}
void xs_test_internal_minimum(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}
void xs_test_psram_free(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
}