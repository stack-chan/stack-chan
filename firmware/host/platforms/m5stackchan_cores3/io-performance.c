// CoreS3 runtime controls. Measurement hooks are no-ops in normal builds.
#include "xsHost.h"
#include "xsmc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "io-performance.h"
#include <string.h>

void xs_io_main_priority(xsMachine *the) {
  if (xsmcArgc < 1) xsTypeError("main priority is required");
  xsType type = xsmcTypeOf(xsArg(0));
  if (type != xsIntegerType && type != xsNumberType) xsTypeError("main priority must be a number");
  double value = xsmcToNumber(xsArg(0));
  if (!(value >= 4 && value <= 13) || value >= configMAX_PRIORITIES || value != (int)value)
    xsRangeError("supported main priorities: 4 through 13");
  int priority = (int)value;
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
