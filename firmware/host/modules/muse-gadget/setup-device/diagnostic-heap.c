#include "xsmc.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"

void xs_muse_diag_internal_free(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}
void xs_muse_diag_internal_minimum(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}
void xs_muse_diag_internal_largest(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}
void xs_muse_diag_psram_free(xsMachine *the) {
  xsmcSetInteger(xsResult, heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
}
void xs_muse_diag_now(xsMachine *the) {
  xsmcSetNumber(xsResult, esp_timer_get_time() / 1000.0);
}
