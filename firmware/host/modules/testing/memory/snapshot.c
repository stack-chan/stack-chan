// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
#include "xsHost.h"
#include "xsmc.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"

void xs_memory_diagnostics_snapshot(xsMachine *the)
{
  const uint32_t caps[] = {
    MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT,
    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
  };
  const char *names[] = {"internal", "psram"};
  multi_heap_info_t info[2];
  size_t total[2];
  int64_t at = esp_timer_get_time();
  // Read both pools before allocating any XS result objects or log strings.
  // These are sequential observations, not an atomic system-wide snapshot.
  for (unsigned i = 0; i < 2; i++) {
    heap_caps_get_info(&info[i], caps[i]);
    total[i] = heap_caps_get_total_size(caps[i]);
  }
  int64_t end = esp_timer_get_time();

  xsmcVars(2);
  xsmcSetNewObject(xsResult);
  xsmcSetNumber(xsVar(0), (double)at);
  xsmcSet(xsResult, xsID("atUs"), xsVar(0));
  xsmcSetNumber(xsVar(0), (double)(end - at));
  xsmcSet(xsResult, xsID("durationUs"), xsVar(0));
  for (unsigned i = 0; i < 2; i++) {
    xsmcSetNewObject(xsVar(1));
#define FIELD(name, value) \
    xsmcSetNumber(xsVar(0), (double)(value)); \
    xsmcSet(xsVar(1), xsID(name), xsVar(0))
    FIELD("totalBytes", total[i]);
    FIELD("freeBytes", info[i].total_free_bytes);
    FIELD("allocatedBytes", info[i].total_allocated_bytes);
    FIELD("minimumFreeBytes", info[i].minimum_free_bytes);
    FIELD("largestFreeBlockBytes", info[i].largest_free_block);
#undef FIELD
    xsmcSet(xsResult, xsID(names[i]), xsVar(1));
  }
}
