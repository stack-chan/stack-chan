// CoreS3 runtime controls. Measurement hooks are no-ops in normal builds.
#include "xsHost.h"
#include "xsmc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "io-performance.h"
#include <string.h>

void xs_io_main_priority(xsMachine *the) {
  int priority = xsmcToInteger(xsArg(0));
  if (priority < 0 || priority >= configMAX_PRIORITIES) xsRangeError("invalid main priority");
  if (strcmp(pcTaskGetName(NULL), "main")) xsUnknownError("main thread required");
  UBaseType_t previous = uxTaskPriorityGet(NULL);
  vTaskPrioritySet(NULL, priority);
  xsmcSetInteger(xsResult, previous);
}
// Existing MODs can call these hooks without requiring a measurement build.
__attribute__((weak)) void xs_io_reset(xsMachine *the) {}
__attribute__((weak)) void xs_io_mark(xsMachine *the) {}
__attribute__((weak)) void xs_io_stats(xsMachine *the) {}
__attribute__((weak)) void stackchanAudioReset(void) {}
__attribute__((weak)) void stackchanAudioProgress(unsigned direction, int64_t now) {}
