#include "sdk-token-store.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>
#include <stdatomic.h>

static atomic_flag writing=ATOMIC_FLAG_INIT;
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
MuseSDKResult muse_sdk_token_store_if_absent_approved(const char *token) {
  if (!muse_sdk_token_valid(token)) return MSDK_INVALID;
  if (atomic_flag_test_and_set(&writing)) return MSDK_BUSY;
  MuseSDKResult result=muse_sdk_token_presence();
  if (result!=MSDK_ABSENT) { if (result==MSDK_INVALID) result=MSDK_EXISTS; goto done; }
  nvs_handle_t handle;
  if (nvs_open("muse_sdk",NVS_READWRITE,&handle)!=ESP_OK) { result=MSDK_IO; goto done; }
  result=presence(handle);
  if (result!=MSDK_ABSENT) { nvs_close(handle); if (result==MSDK_INVALID) result=MSDK_EXISTS; goto done; }
  esp_err_t error=nvs_set_str(handle,"sdk_token",token);
  if (error==ESP_OK) error=nvs_commit(handle);
  nvs_close(handle);
  if (error!=ESP_OK) { result=MSDK_IO; goto done; }
  char check[MUSE_SDK_TOKEN_LENGTH+1]={0};
  result=muse_sdk_token_read(check);
  if (result!=MSDK_OK || memcmp(check,token,MUSE_SDK_TOKEN_LENGTH+1)) result=MSDK_IO;
  wipe(check,sizeof(check));
done: atomic_flag_clear(&writing); return result;
}
