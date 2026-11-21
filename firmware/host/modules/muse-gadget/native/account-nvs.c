#include "account-nvs.h"
#include "account-session-core.h"
#include "nvs.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "esp_mac.h"

bool muse_account_nvs_store(void *context,const char *ns,const char *key,const void *blob,size_t length) {
  (void)context;
  if (!ns || !key || strcmp(ns,MUSE_ACCOUNT_NAMESPACE) || strcmp(key,MUSE_ACCOUNT_KEY) || !blob || !length || length>8192) return false;
  unsigned char *check=calloc(1,length); if (!check) return false;
  nvs_handle_t h; bool ok=false;
  if (nvs_open(MUSE_ACCOUNT_NAMESPACE,NVS_READWRITE,&h)!=ESP_OK) goto done;
  if (nvs_set_blob(h,MUSE_ACCOUNT_KEY,blob,length)!=ESP_OK) { nvs_close(h); goto done; }
  if (nvs_commit(h)!=ESP_OK) { nvs_close(h); goto done; }
  nvs_close(h);
  if (nvs_open(MUSE_ACCOUNT_NAMESPACE,NVS_READONLY,&h)!=ESP_OK) goto done;
  size_t actual=length;
  ok=nvs_get_blob(h,MUSE_ACCOUNT_KEY,check,&actual)==ESP_OK && actual==length && !memcmp(check,blob,length);
  nvs_close(h);
done:
  { volatile unsigned char *p=check; for (size_t i=0;i<length;i++) p[i]=0; }
  free(check); return ok;
}
MuseAccountRestoreResult muse_account_nvs_restore_result(uint32_t generation,MuseAccount **out) {
  if (!generation || !out) return MA_RESTORE_INVALID;
  *out=NULL;
  nvs_handle_t h;
  esp_err_t error=nvs_open(MUSE_ACCOUNT_NAMESPACE,NVS_READONLY,&h);
  if (error!=ESP_OK) return error==ESP_ERR_NVS_NOT_FOUND ? MA_RESTORE_ABSENT : MA_RESTORE_IO;
  size_t length=0;
  error=nvs_get_blob(h,MUSE_ACCOUNT_KEY,NULL,&length);
  if (error!=ESP_OK || !length || length>8192) {
    nvs_close(h);
    return error==ESP_ERR_NVS_NOT_FOUND ? MA_RESTORE_ABSENT : error==ESP_OK || error==ESP_ERR_NVS_TYPE_MISMATCH ? MA_RESTORE_INVALID : MA_RESTORE_IO;
  }
  char *blob=calloc(1,length); if (!blob) { nvs_close(h); return MA_RESTORE_IO; }
  size_t actual=length;
  error=nvs_get_blob(h,MUSE_ACCOUNT_KEY,blob,&actual);
  if (error==ESP_OK && actual==length) *out=muse_account_restore_blob(blob,length,generation);
  nvs_close(h);
  volatile char *p=blob; for (size_t i=0;i<length;i++) p[i]=0;
  free(blob); return error!=ESP_OK ? MA_RESTORE_IO : *out ? MA_RESTORE_OK : MA_RESTORE_INVALID;
}
MuseAccount *muse_account_nvs_restore(uint32_t generation) {
  MuseAccount *owner=NULL; muse_account_nvs_restore_result(generation,&owner); return owner;
}
MuseAccountWiFiUpdateResult muse_account_nvs_update_wifi_approved(const char *ssid,const char *password) {
  if (!muse_account_wifi_valid(ssid,password)) return MA_WIFI_INVALID;
  MuseAccount *account=NULL;
  MuseAccountRestoreResult restored=muse_account_nvs_restore_result(1,&account);
  if (restored==MA_RESTORE_ABSENT) return MA_WIFI_ABSENT;
  if (restored==MA_RESTORE_INVALID) return MA_WIFI_INVALID;
  if (restored!=MA_RESTORE_OK) return MA_WIFI_IO;
  MuseAccountResult result=muse_account_update_wifi_approved(account,1,ssid,password,muse_account_nvs_store,NULL);
  muse_account_close(account);
  return result==MA_OK ? MA_WIFI_UPDATED : MA_WIFI_IO;
}
bool muse_account_device_id(char *out,size_t capacity) {
  if (!out || capacity<16) return false;
  uint8_t mac[6];
  if (esp_read_mac(mac,ESP_MAC_WIFI_STA)!=ESP_OK) return false;
  int n=snprintf(out,capacity,"homelink-%02x%02x%02x",mac[3],mac[4],mac[5]);
  return n>0 && (size_t)n<capacity;
}
