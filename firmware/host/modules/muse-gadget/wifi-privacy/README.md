# Wi-Fi diagnostic privacy guard

The standalone host must call `silenceWifiLogs()` from `muse-wifi-privacy` before constructing the Wi-Fi interface. The module sets only the ESP-IDF `wifi` and `wifi_init` tags to `ESP_LOG_NONE`, then verifies the effective levels. It takes no SSID, password, or other data and emits no log. Failure throws a fixed error so the host can stop before starting Wi-Fi.

The installed ESP-IDF `components/log/include/esp_log_level.h` documents that `esp_log_level_set` is a no-op without `CONFIG_LOG_DYNAMIC_LEVEL_CONTROL`. The target configuration enables that setting, and the native source refuses to compile without it. No shared SDK files or global wildcard logging level are changed.

This prevents those driver tags from printing network names. It does not sanitize application logs or arbitrary future tags; callers must still avoid logging configuration values and raw exception messages. Disabling these tags also hides their connection diagnostics; the app's credential-free state reporting remains available.

The Node tests check the explicit, data-free wrapper call and static tag/guard policy. Target compilation verifies the real ESP-IDF API is available. No Wi-Fi connection or hardware test is performed by this module's tests.
