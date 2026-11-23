#include "sdk-token-store.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

bool muse_sdk_pairing_privacy(void) {
  esp_log_level_set("link.pairing",ESP_LOG_NONE);
  return esp_log_level_get("link.pairing")==ESP_LOG_NONE;
}
static void wipe(void *buffer,size_t size) { volatile unsigned char *p=buffer; while (size--) *p++=0; }
bool muse_sdk_token_valid(const char *token) {
  if (!token || strlen(token)!=MUSE_SDK_TOKEN_LENGTH || strncmp(token,"mgst_",5)) return false;
  for (const unsigned char *p=(const unsigned char *)token+5;*p;p++) {
    if (!(*p>='A' && *p<='Z') && !(*p>='a' && *p<='z') && !(*p>='0' && *p<='9') && *p!='_' && *p!='-') return false;
  }
  return strchr("AEIMQUYcgkosw048",token[MUSE_SDK_TOKEN_LENGTH-1])!=NULL;
}
static MuseSDKResult presence(nvs_handle_t handle) {
  size_t size=0;
  esp_err_t error=nvs_get_str(handle,"sdk_token",NULL,&size);
  if (error==ESP_ERR_NVS_NOT_FOUND) return MSDK_ABSENT;
  if (error==ESP_ERR_NVS_TYPE_MISMATCH || (error==ESP_OK && size!=MUSE_SDK_TOKEN_LENGTH+1)) return MSDK_INVALID;
  return error==ESP_OK ? MSDK_EXISTS : MSDK_IO;
}
MuseSDKResult muse_sdk_token_presence(void) {
  nvs_handle_t handle;
  esp_err_t error=nvs_open("muse_sdk",NVS_READONLY,&handle);
  if (error!=ESP_OK) return error==ESP_ERR_NVS_NOT_FOUND ? MSDK_ABSENT : MSDK_IO;
  MuseSDKResult result=presence(handle); nvs_close(handle); return result;
}
MuseSDKResult muse_sdk_token_read(char out[MUSE_SDK_TOKEN_LENGTH+1]) {
  if (!out) return MSDK_INVALID;
  wipe(out,MUSE_SDK_TOKEN_LENGTH+1);
  nvs_handle_t handle;
  esp_err_t error=nvs_open("muse_sdk",NVS_READONLY,&handle);
  if (error!=ESP_OK) return error==ESP_ERR_NVS_NOT_FOUND ? MSDK_ABSENT : MSDK_IO;
  MuseSDKResult result=presence(handle);
  if (result==MSDK_EXISTS) {
    size_t size=MUSE_SDK_TOKEN_LENGTH+1;
    error=nvs_get_str(handle,"sdk_token",out,&size);
    result=error!=ESP_OK ? MSDK_IO : size==MUSE_SDK_TOKEN_LENGTH+1 && out[MUSE_SDK_TOKEN_LENGTH]==0 && muse_sdk_token_valid(out) ? MSDK_OK : MSDK_INVALID;
  }
  nvs_close(handle);
  if (result!=MSDK_OK) wipe(out,MUSE_SDK_TOKEN_LENGTH+1);
  return result;
}
