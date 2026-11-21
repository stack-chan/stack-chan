#pragma once
typedef int esp_err_t;
typedef int wifi_mode_t;
#define ESP_OK 0
#define WIFI_MODE_STA 1
#define WIFI_STORAGE_RAM 2
#define WIFI_IF_STA 3
typedef struct { struct { unsigned char ssid[32],password[64]; } sta; } wifi_config_t;
int esp_wifi_get_mode(wifi_mode_t *);
int esp_wifi_set_storage(int);
int esp_wifi_set_config(int,wifi_config_t *);
int esp_wifi_connect(void);

typedef struct { unsigned reason; } wifi_event_sta_disconnected_t;
#define WIFI_REASON_NO_AP_FOUND 1
#define WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY 2
#define WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD 3
#define WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD 4
#define WIFI_REASON_AUTH_EXPIRE 5
#define WIFI_REASON_AUTH_FAIL 6
#define WIFI_REASON_802_1X_AUTH_FAILED 7
#define WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT 8
#define WIFI_REASON_HANDSHAKE_TIMEOUT 9
#define WIFI_REASON_TIMEOUT 10
#define WIFI_REASON_BEACON_TIMEOUT 11
#define WIFI_REASON_GROUP_KEY_UPDATE_TIMEOUT 12
#define WIFI_REASON_SA_QUERY_TIMEOUT 13
