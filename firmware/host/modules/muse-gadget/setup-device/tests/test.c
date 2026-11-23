#include "nvs.h"
#include "esp_mac.h"
#include "setup-metadata-core.h"
#include "sdk-token-store.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static int mode;
MuseSDKResult muse_sdk_token_presence(void){return MSDK_ABSENT;}
int nvs_open(const char *ns,int access,nvs_handle_t *h) { assert(access==NVS_READONLY); *h=!strcmp(ns,"muse_account")?0:!strcmp(ns,"muse")?1:2; return mode==0?ESP_ERR_NVS_NOT_FOUND:ESP_OK; }
void nvs_close(nvs_handle_t h) { (void)h; }
int nvs_get_blob(nvs_handle_t h,const char *key,void *data,size_t *size) { assert(h==0&&!strcmp(key,"record")&&!data); *size=0; return mode==1?ESP_OK:ESP_ERR_NVS_NOT_FOUND; }
int nvs_get_str(nvs_handle_t h,const char *key,char *data,size_t *size) { (void)key; assert(!data);*size=0;return mode==2&&h==1?ESP_ERR_NVS_TYPE_MISMATCH:mode==3?99:ESP_ERR_NVS_NOT_FOUND; }
int esp_read_mac(uint8_t *out,int type) { assert(type==ESP_MAC_WIFI_STA); memset(out,1,6);return mode==4?99:ESP_OK; }
int main(void) {
 MuseSetupMetadata m;
 mode=0;assert(muse_setup_metadata(&m)&&!m.stored);assert(!strcmp(m.id,"stopwatch-010101010101"));
 mode=1;assert(muse_setup_metadata(&m)&&m.stored);
 mode=2;assert(muse_setup_metadata(&m)&&m.stored);
 mode=3;assert(!muse_setup_metadata(&m));
 mode=4;assert(!muse_setup_metadata(&m));
 puts("MUSE_SETUP_METADATA_PASS");
}
