// Test-only operation boundaries. RTOS/ISR events come from esp_sysview.
#include "xsmc.h"
#include "SEGGER_SYSVIEW.h"
#include "esp_audio_enc.h"
#include "esp_audio_dec.h"
#include "esp_trace.h"
#include "esp_trace_registry.h"
#include "esp_trace_port_transport.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_attr.h"
#include "esp_private/cache_utils.h"
#include <stdatomic.h>
#include <string.h>

// The encoder serializes these callbacks with interrupts disabled. A flash
// cache-off rendezvous cannot start on the other CPU until this lock is left.
// When already cache-off, reject the write without touching external RAM;
// dropped captures must never be published as a complete timeline.
static uint8_t *recording;
static size_t used, capacity;
static uint32_t dropped;
static atomic_bool stopped = true;
static esp_timer_handle_t deadline;
static esp_err_t IRAM_ATTR ramInit(esp_trace_transport_t *tp, const void *cfg) { return ESP_OK; }
static esp_err_t IRAM_ATTR ramSet(esp_trace_transport_t *tp, esp_trace_transport_cfg_key_t key, const void *v) { return ESP_OK; }
static esp_err_t IRAM_ATTR ramRead(esp_trace_transport_t *tp, void *dst, size_t *n, uint32_t tmo) { *n = 0; return ESP_OK; }
static esp_err_t IRAM_ATTR ramWrite(esp_trace_transport_t *tp, const void *src, size_t n, uint32_t tmo) {
  if (!spi_flash_cache_enabled()) { dropped++; return ESP_ERR_INVALID_STATE; }
  if (!recording || n > capacity - used) { dropped++; return ESP_ERR_NO_MEM; }
  memcpy(recording + used, src, n);
  used += n;
  return ESP_OK;
}
static esp_err_t IRAM_ATTR ramFlush(esp_trace_transport_t *tp) { return ESP_OK; }
static esp_err_t IRAM_ATTR ramDown(esp_trace_transport_t *tp, uint8_t *b, uint32_t n) { return ESP_OK; }
static bool IRAM_ATTR ramConnected(esp_trace_transport_t *tp) { return true; }
// Select SystemView's format carrying both core IDs; no JTAG I/O is performed.
static esp_trace_link_types_t IRAM_ATTR ramLink(esp_trace_transport_t *tp) { return ESP_TRACE_LINK_DEBUG_PROBE; }
static DRAM_ATTR esp_trace_transport_vtable_t ramTransport = {
  .init = ramInit, .set_config = ramSet, .read = ramRead, .write = ramWrite,
  .flush_nolock = ramFlush, .down_buffer_config = ramDown,
  .is_host_connected = ramConnected, .get_link_type = ramLink,
};
ESP_TRACE_REGISTER_TRANSPORT("stackchan-ram", &ramTransport);
esp_trace_open_params_t esp_trace_get_user_params(void) {
  return (esp_trace_open_params_t){.encoder_name = "sysview", .transport_name = "stackchan-ram"};
}
static void stopCapture(void *arg) {
  SEGGER_SYSVIEW_Stop();
  atomic_store(&stopped, true);
}
void xs_task_trace_capture(xsMachine *the) {
  int ms = xsmcToInteger(xsArg(0));
  if (ms < 10 || ms > 500 || recording) xsUnknownError("Invalid trace capture state");
  if (!deadline) {
    esp_timer_create_args_t args = {.callback = stopCapture, .name = "trace-stop"};
    if (esp_timer_create(&args, &deadline) != ESP_OK) xsUnknownError("Trace timer unavailable");
  }
  capacity = 64 * 1024;
  recording = heap_caps_malloc(capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!recording) xsUnknownError("Trace PSRAM unavailable");
  used = 0; dropped = 0;
  atomic_store(&stopped, false);
  SEGGER_SYSVIEW_Start();
  if (esp_timer_start_once(deadline, ms * 1000) != ESP_OK) {
    stopCapture(NULL); heap_caps_free(recording); recording = NULL;
    xsUnknownError("Trace timer failed");
  }
}
void xs_task_trace_dropped(xsMachine *the) { xsmcSetInteger(xsResult, dropped); }
void xs_task_trace_take(xsMachine *the) {
  if (!atomic_load(&stopped) || !recording) xsUnknownError("Trace is not stopped");
  if (dropped) {
    heap_caps_free(recording); recording = NULL;
    xsUnknownError("Trace contains dropped writes");
  }
  xsmcSetArrayBuffer(xsResult, recording, used);
  heap_caps_free(recording); recording = NULL;
}

void xs_task_trace_begin(xsMachine *the) {
  SEGGER_SYSVIEW_OnUserStart(xsmcToInteger(xsArg(0)));
}
void xs_task_trace_end(xsMachine *the) {
  SEGGER_SYSVIEW_OnUserStop(xsmcToInteger(xsArg(0)));
}
void xs_task_trace_active(xsMachine *the) {
  xsmcSetBoolean(xsResult, !atomic_load(&stopped));
}

extern esp_audio_err_t __real_esp_audio_enc_process(esp_audio_enc_handle_t,
  esp_audio_enc_in_frame_t *, esp_audio_enc_out_frame_t *);
esp_audio_err_t __wrap_esp_audio_enc_process(esp_audio_enc_handle_t handle,
  esp_audio_enc_in_frame_t *input, esp_audio_enc_out_frame_t *output) {
  SEGGER_SYSVIEW_OnUserStart(1);
  esp_audio_err_t result = __real_esp_audio_enc_process(handle, input, output);
  SEGGER_SYSVIEW_OnUserStop(1);
  return result;
}

extern esp_audio_err_t __real_esp_audio_dec_process(esp_audio_dec_handle_t,
  esp_audio_dec_in_raw_t *, esp_audio_dec_out_frame_t *);
esp_audio_err_t __wrap_esp_audio_dec_process(esp_audio_dec_handle_t handle,
  esp_audio_dec_in_raw_t *input, esp_audio_dec_out_frame_t *output) {
  SEGGER_SYSVIEW_OnUserStart(2);
  esp_audio_err_t result = __real_esp_audio_dec_process(handle, input, output);
  SEGGER_SYSVIEW_OnUserStop(2);
  return result;
}
