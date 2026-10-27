// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

#include "media_lib_adapter.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdatomic.h>

// MP3 and Opus may be constructed in a Worker before the first WebRTC session.
// Install the allocator callbacks lazily, once across all VMs, before any codec
// uses them. Standard firmware does not need a startup task or performance setup.
int stackchanRealtimeMediaInit(void) {
  static atomic_int state;
  for (;;) {
    if (atomic_load(&state) == 2) return ESP_OK;
    int expected = 0;
    if (atomic_compare_exchange_strong(&state, &expected, 1)) {
      int err = media_lib_add_default_adapter();
      atomic_store(&state, err ? 0 : 2);
      return err;
    }
    vTaskDelay(1);
  }
}
