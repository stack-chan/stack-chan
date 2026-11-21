#include "xsmc.h"
#include "xsHost.h"
#include "esp_log.h"
#include "sdkconfig.h"

#if !CONFIG_LOG_DYNAMIC_LEVEL_CONTROL
#error "Muse WiFi privacy requires dynamic per-tag log levels"
#endif

void xs_muse_silence_wifi_logs(xsMachine *the) {
  esp_log_level_set("wifi", ESP_LOG_NONE);
  esp_log_level_set("wifi_init", ESP_LOG_NONE);
  if (esp_log_level_get("wifi") != ESP_LOG_NONE || esp_log_level_get("wifi_init") != ESP_LOG_NONE)
    xsUnknownError("WiFi log suppression unavailable");
}
