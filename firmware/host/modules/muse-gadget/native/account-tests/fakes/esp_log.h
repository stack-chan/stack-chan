#pragma once
#define ESP_LOG_NONE 0
int esp_log_level_get(const char *);
void esp_log_level_set(const char *,int);
