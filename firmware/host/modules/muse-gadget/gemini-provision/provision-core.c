#include "provision-core.h"
#include "driver/usb_serial_jtag.h"
#include "nvs.h"
#include <string.h>

static bool owned, dropping, sealed;
static unsigned length;
static char frame[GEMINI_KEY_MAX + 8];

static void wipe(void *data, size_t size) {
  volatile unsigned char *p = data;
  while (size--) *p++ = 0;
}

static void reset_frame(void) {
  wipe(frame, sizeof(frame));
  length = 0;
  dropping = false;
}

static bool valid_key(const char *key) {
  size_t size = strlen(key);
  if (size < 20 || size > GEMINI_KEY_MAX) return false;
  for (size_t i = 0; i < size; i++) {
    unsigned char c = key[i];
    if (c < 33 || c > 126) return false;
  }
  return true;
}

static int presence(nvs_handle_t handle) {
  size_t size = 0;
  esp_err_t error = nvs_get_str(handle, "geminiToken", NULL, &size);
  if (error == ESP_ERR_NVS_NOT_FOUND) return 0;
  if (error == ESP_OK || error == ESP_ERR_NVS_TYPE_MISMATCH) return 4;
  return 3;
}

static int save_if_absent(const char *key) {
  if (!valid_key(key)) return 3;
  nvs_handle_t handle;
  esp_err_t error = nvs_open("ai", NVS_READONLY, &handle);
  if (error == ESP_OK) {
    int existing = presence(handle);
    nvs_close(handle);
    if (existing) return existing;
  } else if (error != ESP_ERR_NVS_NOT_FOUND) return 3;
  if (nvs_open("ai", NVS_READWRITE, &handle) != ESP_OK) return 3;
  int result = presence(handle);
  if (result) { nvs_close(handle); return result; }
  error = nvs_set_str(handle, "geminiToken", key);
  if (error == ESP_OK) error = nvs_commit(handle);
  nvs_close(handle);
  if (error != ESP_OK) return 3;
  if (nvs_open("ai", NVS_READONLY, &handle) != ESP_OK) return 3;
  char check[GEMINI_KEY_MAX + 1] = {0};
  size_t size = sizeof(check), expected = strlen(key) + 1;
  error = nvs_get_str(handle, "geminiToken", check, &size);
  nvs_close(handle);
  result = error == ESP_OK && size == expected && !memcmp(check, key, expected) ? 1 : 3;
  wipe(check, sizeof(check));
  return result;
}

bool gemini_key_input_open(void) {
  if (owned) return false;
  usb_serial_jtag_driver_config_t config = {.rx_buffer_size = 1024, .tx_buffer_size = 256};
  if (usb_serial_jtag_driver_install(&config) != ESP_OK) return false;
  owned = true;
  sealed = false;
  reset_frame();
  return true;
}

int gemini_key_input_poll(void) {
  if (!owned || sealed) return 3;
  unsigned char bytes[64];
  int n = usb_serial_jtag_read_bytes(bytes, sizeof(bytes), 0), result = 0;
  if (n < 0) { wipe(bytes, sizeof(bytes)); reset_frame(); sealed = true; return 3; }
  for (int i = 0; i < n; i++) {
    if (bytes[i] == '\n') {
      if (dropping) result = 3;
      else if (length == 6 && !memcmp(frame, "CANARY", 6)) result = 2;
      else if (length >= 7 && !memcmp(frame, "GEMINI:", 7)) {
        frame[length] = 0;
        result = save_if_absent(frame + 7);
      } else result = 3;
      reset_frame();
      sealed = true;
      break;
    }
    if (bytes[i] < 32 || bytes[i] > 126 || length >= sizeof(frame) - 1) {
      reset_frame();
      dropping = true;
    } else if (!dropping) frame[length++] = (char)bytes[i];
  }
  wipe(bytes, sizeof(bytes));
  return result;
}

void gemini_key_input_close(void) {
  reset_frame();
  sealed = true;
  if (owned) { owned = false; usb_serial_jtag_driver_uninstall(); }
}
