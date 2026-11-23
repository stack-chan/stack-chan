#pragma once
#include <stdint.h>
typedef const char *esp_event_base_t;
typedef void *esp_event_handler_instance_t;
typedef void (*esp_event_handler_t)(void *,esp_event_base_t,int32_t,void *);
extern const char *WIFI_EVENT;
#define WIFI_EVENT_STA_DISCONNECTED 5
int esp_event_handler_instance_register(esp_event_base_t,int32_t,esp_event_handler_t,void *,esp_event_handler_instance_t *);
int esp_event_handler_instance_unregister(esp_event_base_t,int32_t,esp_event_handler_instance_t);
