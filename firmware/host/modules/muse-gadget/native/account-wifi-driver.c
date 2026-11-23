#include "account-wifi-driver.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include <stdatomic.h>
#include <stdint.h>
#include "esp_log.h"
#include <string.h>
bool muse_account_wifi_apply(void *context,const char *ssid,const char *password) {
  (void)context;
  if (!ssid || !password || esp_log_level_get("wifi")!=ESP_LOG_NONE || esp_log_level_get("wifi_init")!=ESP_LOG_NONE) return false;
  wifi_mode_t mode;
  if (esp_wifi_get_mode(&mode)!=ESP_OK || mode!=WIFI_MODE_STA) return false;
  wifi_config_t config={0};
  size_t ssid_size=strlen(ssid), password_size=strlen(password);
  if (!ssid_size || ssid_size>sizeof(config.sta.ssid) || password_size>=sizeof(config.sta.password)) return false;
  if (esp_wifi_set_storage(WIFI_STORAGE_RAM)!=ESP_OK) return false;
  memcpy(config.sta.ssid,ssid,ssid_size); memcpy(config.sta.password,password,password_size);
  esp_err_t result=esp_wifi_set_config(WIFI_IF_STA,&config);
  volatile unsigned char *p=(void *)&config; for (size_t i=0;i<sizeof(config);i++) p[i]=0;
  return result==ESP_OK && esp_wifi_connect()==ESP_OK;
}

static esp_event_handler_instance_t disconnectHandler;
static atomic_uint diagnostic;
static uint32_t nextGeneration, registeredGeneration;
static unsigned reasonCode(unsigned reason) {
  switch(reason) {
    case WIFI_REASON_NO_AP_FOUND:
    case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
    case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD: return 1;
    case WIFI_REASON_AUTH_EXPIRE:
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_802_1X_AUTH_FAILED: return 2;
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT: return 3;
    case WIFI_REASON_TIMEOUT:
    case WIFI_REASON_BEACON_TIMEOUT:
    case WIFI_REASON_GROUP_KEY_UPDATE_TIMEOUT:
    case WIFI_REASON_SA_QUERY_TIMEOUT: return 4;
    default: return 5;
  }
}
static void disconnected(void *arg,esp_event_base_t base,int32_t event,void *data) {
  if(base!=WIFI_EVENT || event!=WIFI_EVENT_STA_DISCONNECTED || !data)return;
  unsigned generation=(uint32_t)(uintptr_t)arg;
  unsigned expected=atomic_load(&diagnostic);
  unsigned reason=reasonCode(((wifi_event_sta_disconnected_t *)data)->reason);
  while((expected>>8)==generation && generation) {
    if(atomic_compare_exchange_weak(&diagnostic,&expected,(generation<<8)|reason))break;
  }
}
uint32_t muse_account_wifi_watch(void) {
  if(disconnectHandler)return 0;
  if(nextGeneration==0xFFFFFF)return 0;
  ++nextGeneration;
  unsigned generation=nextGeneration;
  atomic_store(&diagnostic,generation<<8);
  if(esp_event_handler_instance_register(WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,disconnected,(void *)(uintptr_t)generation,&disconnectHandler)!=ESP_OK) {
    atomic_store(&diagnostic,0); disconnectHandler=NULL; return 0;
  }
  registeredGeneration=generation;
  return generation;
}
const char *muse_account_wifi_reason(uint32_t generation) {
  unsigned state=atomic_load(&diagnostic);
  if(!generation || (state>>8)!=generation)return "none";
  switch(state&255) {
    case 1:return "ap_not_found";
    case 2:return "auth";
    case 3:return "handshake";
    case 4:return "timeout";
    case 5:return "other";
    default:return "none";
  }
}
bool muse_account_wifi_unwatch(uint32_t generation) {
  unsigned expected=atomic_load(&diagnostic);
  if(!generation || registeredGeneration!=generation)return true;
  while((expected>>8)==generation) {
    if(atomic_compare_exchange_weak(&diagnostic,&expected,0))break;
  }
  if(disconnectHandler && esp_event_handler_instance_unregister(WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,disconnectHandler)!=ESP_OK)return false;
  disconnectHandler=NULL; registeredGeneration=0; return true;
}
