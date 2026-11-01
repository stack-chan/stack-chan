// CoreS3 runtime controls. Measurement hooks are no-ops in normal builds.
#include "xsHost.h"
#include "xsmc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "io-performance.h"
#include <string.h>

void xs_io_main_priority(xsMachine *the) {
  int priority = xsmcToInteger(xsArg(0));
  if (priority != 4 && priority != 6) xsRangeError("supported main priorities: 4, 6");
  if (strcmp(pcTaskGetName(NULL), "main")) xsUnknownError("main thread required");
  vTaskPrioritySet(NULL, priority);
}
// Existing MODs can call these hooks without requiring a measurement build.
__attribute__((weak)) void xs_io_reset(xsMachine *the) {}
__attribute__((weak)) void xs_io_mark(xsMachine *the) {}
__attribute__((weak)) void xs_io_stats(xsMachine *the) {}
__attribute__((weak)) void stackchanAudioReset(void) {}
__attribute__((weak)) void stackchanAudioProgress(unsigned direction, int64_t now) {}
