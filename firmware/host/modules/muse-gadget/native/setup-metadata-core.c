#include "setup-metadata-core.h"
#include "sdk-token-store.h"
#include "account-nvs.h"
#include "esp_mac.h"
#include <stdio.h>
#include <string.h>
bool muse_setup_metadata(MuseSetupMetadata *out) {
  if (!out) return false;
  memset(out,0,sizeof(*out));
  MuseAccount *stored = NULL;
  MuseAccountRestoreResult restored = muse_account_nvs_restore_result(1, &stored);
  if (restored == MA_RESTORE_IO) return false;
  if (restored == MA_RESTORE_OK) {
    out->stored = true;
    muse_account_close(stored);
  }
  MuseSDKResult sdk=muse_sdk_token_presence();
  out->sdkReady=sdk==MSDK_EXISTS;
  uint8_t mac[6];
  if (esp_read_mac(mac,ESP_MAC_WIFI_STA)!=ESP_OK) return false;
  snprintf(out->id,sizeof(out->id),"homelink-%02x%02x%02x",mac[3],mac[4],mac[5]);
  snprintf(out->mac,sizeof(out->mac),"%02x:%02x:%02x:%02x:%02x:%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
  snprintf(out->device,sizeof(out->device),"hatch-link:%s",out->mac);
  return true;
}
