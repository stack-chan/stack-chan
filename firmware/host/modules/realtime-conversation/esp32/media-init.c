// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

#include "media_lib_adapter.h"
#include "esp_audio_enc_default.h"
#include "esp_audio_dec_default.h"
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

// Codec registration can allocate registry entries and fail under pressure.
// Keep it separate from the shared allocator setup used by ordinary playback.
// A partial default registration is safe to retry: existing entries are reused.
int stackchanRealtimeCodecInit(void) {
  static atomic_int state;
  for (;;) {
    if (atomic_load(&state) == 2) return ESP_AUDIO_ERR_OK;
    int expected = 0;
    if (atomic_compare_exchange_strong(&state, &expected, 1)) {
      int err = esp_audio_enc_register_default();
      if (!err) err = esp_audio_dec_register_default();
      atomic_store(&state, err ? 0 : 2);
      return err;
    }
    vTaskDelay(1);
  }
}
