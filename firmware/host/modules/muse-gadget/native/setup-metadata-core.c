#include "setup-metadata-core.h"
#include "sdk-token-store.h"
#include "esp_mac.h"
#include "nvs.h"
#include <stdio.h>
#include <string.h>
bool muse_setup_metadata(MuseSetupMetadata *out) {
  if (!out) return false;
  memset(out,0,sizeof(*out));
  const char *domains[]={"muse_account","muse","homehub","homehub","homehub"};
  const char *keys[]={"record","token","access_token","refresh_token","auth_token"};
  for (unsigned i=0;i<5;i++) {
    nvs_handle_t handle;
    esp_err_t error=nvs_open(domains[i],NVS_READONLY,&handle);
    if (error==ESP_ERR_NVS_NOT_FOUND) continue;
    if (error!=ESP_OK) return false;
    size_t size=0;
    error=i==0 ? nvs_get_blob(handle,keys[i],NULL,&size) : nvs_get_str(handle,keys[i],NULL,&size);
    nvs_close(handle);
    if (error==ESP_OK || error==ESP_ERR_NVS_TYPE_MISMATCH) out->stored=true;
    else if (error!=ESP_ERR_NVS_NOT_FOUND) return false;
  }
  MuseSDKResult sdk=muse_sdk_token_presence();
  out->sdkReady=sdk==MSDK_EXISTS;
  if(!out->stored && sdk!=MSDK_EXISTS && sdk!=MSDK_ABSENT)return false;
  uint8_t mac[6];
  if (esp_read_mac(mac,ESP_MAC_WIFI_STA)!=ESP_OK) return false;
  snprintf(out->id,sizeof(out->id),"homelink-%02x%02x%02x",mac[3],mac[4],mac[5]);
  snprintf(out->mac,sizeof(out->mac),"%02x:%02x:%02x:%02x:%02x:%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
  snprintf(out->device,sizeof(out->device),"hatch-link:%s",out->mac);
  return true;
}
