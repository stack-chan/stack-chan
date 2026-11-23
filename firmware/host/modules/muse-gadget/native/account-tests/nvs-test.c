#include "../account-nvs.h"
#include "nvs.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
#include "cJSON.h"
static char stored[8192];
static size_t stored_size;
static int fault, commits, sets, opens, closes;
int esp_read_mac(uint8_t *out,int type) { assert(type==1); for (unsigned i=0;i<6;i++) out[i]=(uint8_t)i; return 0; }
int nvs_open(const char *ns,int mode,nvs_handle_t *h) {
  assert(!strcmp(ns,"muse_account"));
  assert(mode==NVS_READONLY || mode==NVS_READWRITE);
  if (fault==1) return -1;
  if (fault==6) return ESP_ERR_NVS_NOT_FOUND;
  opens++; *h=42; return 0;
}
void nvs_close(nvs_handle_t h) { assert(h==42); closes++; }
int nvs_set_blob(nvs_handle_t h,const char *key,const void *b,size_t n) {
  assert(h==42 && !strcmp(key,"record") && n<sizeof(stored)); sets++;
  if (fault==2) return -1;
  memcpy(stored,b,n); stored_size=n; return 0;
}
int nvs_commit(nvs_handle_t h) { assert(h==42); commits++; return fault==3 ? -1 : 0; }
int nvs_get_blob(nvs_handle_t h,const char *key,void *b,size_t *n) {
  assert(h==42 && !strcmp(key,"record"));
  if (fault==4) return -1;
  if (fault==7) return ESP_ERR_NVS_NOT_FOUND;
  if (fault==8) return ESP_ERR_NVS_TYPE_MISMATCH;
  if (!b) { *n=stored_size; return 0; }
  if (*n<stored_size) return -1;
  memcpy(b,stored,stored_size); *n=stored_size;
  if (fault==5) ((char *)b)[0]^=1;
  if (fault==9 && sets) ((char *)b)[0]^=1;
  return 0;
}
static char longAccess[2049],longRefresh[2049];
static unsigned copyRequests;
static bool copyCurrent(void *ctx,uint32_t generation) { (void)ctx;return generation==77; }
static bool copyHTTP(void *ctx,const char *origin,const char *path,const char *method,const char *auth,const char *body,char *response,size_t capacity,size_t *length,int *status,bool *redirected) {
  (void)ctx;(void)origin;(void)method;(void)body;(void)response;(void)capacity;
  copyRequests++;
  if(copyRequests==1) {
    assert(!strcmp(path,"/fetch_vms") && strlen(auth)==2055);
    assert(!strncmp(auth,"Bearer ",7) && !memcmp(auth+7,longAccess,2049));
  } else {
    assert(copyRequests==2 && !strcmp(path,"/device_token/refresh"));
    assert(strlen(auth)==2069 && !strncmp(auth,"Bearer hatch_refresh:",21) && !memcmp(auth+21,longRefresh,2049));
  }
  *length=0;*status=401;*redirected=false;return true;
}
int main(void) {
  const char blob[]="fixture-new";
  assert(!muse_account_nvs_store(NULL,"homehub","record",blob,sizeof(blob)));
  assert(!muse_account_nvs_store(NULL,"muse_account","access_token",blob,sizeof(blob)));
  assert(opens==0 && sets==0);
  for (fault=0;fault<=5;fault++) {
    strcpy(stored,"fixture-old"); stored_size=strlen(stored)+1;
    commits=sets=opens=closes=0;
    assert(muse_account_nvs_store(NULL,"muse_account","record",blob,sizeof(blob))==(fault==0));
    assert(opens==closes && commits<=1 && sets<=1);
    if (fault==1 || fault==2) assert(!strcmp(stored,"fixture-old"));
    if (fault==3) assert(!strcmp(stored,"fixture-new"));
  }
  fault=0; sets=commits=0;
  const char *record="{\"version\":1,\"ssid\":\"fixture\",\"password\":\"fixture\",\"access_token\":\"fixture\",\"refresh_token\":\"fixture\"}";
  strcpy(stored,record); stored_size=strlen(record);
  MuseAccount *owner=muse_account_nvs_restore(9); assert(owner); muse_account_close(owner);
  assert(!sets && !commits);
  strcpy(stored,"{\"version\":2}"); stored_size=strlen(stored);
  assert(!muse_account_nvs_restore(9));
  strcpy(stored,"{\"version\":1,\"version\":1}"); stored_size=strlen(stored);
  assert(!muse_account_nvs_restore(9));
  fault=4; assert(!muse_account_nvs_restore(9));
  MuseAccount *restored=NULL;
  fault=6; assert(muse_account_nvs_restore_result(9,&restored)==MA_RESTORE_ABSENT);
  fault=7; assert(muse_account_nvs_restore_result(9,&restored)==MA_RESTORE_ABSENT);
  fault=8; assert(muse_account_nvs_restore_result(9,&restored)==MA_RESTORE_INVALID);
  fault=4; assert(muse_account_nvs_restore_result(9,&restored)==MA_RESTORE_IO);
  char identity[32]; assert(muse_account_device_id(identity,sizeof(identity)) && !strcmp(identity,"homelink-030405"));
  const char *wifiRecord="{\"version\":1,\"ssid\":\"old-public\",\"password\":\"old-password\",\"access_token\":\"access-public-fixture\",\"refresh_token\":\"refresh-public-fixture\"}";
  for (int mode=0;mode<=9;mode++) {
    fault=mode; sets=commits=0;
    memset(stored,0,sizeof(stored)); strcpy(stored,wifiRecord); stored_size=strlen(stored);
    MuseAccountWiFiUpdateResult result=muse_account_nvs_update_wifi_approved("new-public","new-password");
    assert(result==(mode==0 ? MA_WIFI_UPDATED : mode==6 || mode==7 ? MA_WIFI_ABSENT : mode==5 || mode==8 ? MA_WIFI_INVALID : MA_WIFI_IO));
    assert(sets<=1 && commits<=1 && opens==closes);
    if (mode==0 || mode==3 || mode==9) {
      cJSON *j=cJSON_Parse(stored); assert(j && cJSON_GetArraySize(j)==5);
      assert(!strcmp(cJSON_GetObjectItemCaseSensitive(j,"ssid")->valuestring,"new-public"));
      assert(!strcmp(cJSON_GetObjectItemCaseSensitive(j,"password")->valuestring,"new-password"));
      assert(!strcmp(cJSON_GetObjectItemCaseSensitive(j,"access_token")->valuestring,"access-public-fixture"));
      assert(!strcmp(cJSON_GetObjectItemCaseSensitive(j,"refresh_token")->valuestring,"refresh-public-fixture"));
      assert(cJSON_GetObjectItemCaseSensitive(j,"version")->valuedouble==1); cJSON_Delete(j);
    } else assert(!strcmp(stored,wifiRecord));
  }
  fault=0; sets=commits=0;
  strcpy(stored,"{\"version\":2}"); stored_size=strlen(stored);
  assert(muse_account_nvs_update_wifi_approved("new","new-password")==MA_WIFI_INVALID && !sets);
  assert(muse_account_nvs_update_wifi_approved("new","")==MA_WIFI_INVALID && !sets);
  assert(muse_account_nvs_update_wifi_approved("bad\nssid","new-password")==MA_WIFI_INVALID && !sets);
  for(unsigned i=0;i<2048;i++) { longAccess[i]=(char)('A'+i%26);longRefresh[i]=(char)('a'+i%26); }
  char source[8192];
  int sourceSize=snprintf(source,sizeof(source),"{\"action\":\"provision_v2\",\"ssid\":\"fixture\",\"password\":\"fixture\",\"access_token\":\"%s\",\"refresh_token\":\"%s\",\"token_type\":\"device\"}",longAccess,longRefresh);
  owner=muse_account_claim(source,(size_t)sourceSize,77,copyCurrent,NULL);assert(owner);
  memset(source,0,sizeof(source));
  assert(muse_account_commit_approved(owner,77,muse_account_nvs_store,NULL)==MA_OK);
  muse_account_close(owner);
  owner=muse_account_nvs_restore(77);assert(owner);
  memset(stored,0,sizeof(stored));stored_size=0;
  assert(muse_account_connect_approved(owner,77,"homelink-030405",copyHTTP,muse_account_nvs_store,NULL)==MA_REVOKED && copyRequests==2);
  muse_account_close(owner);
  puts("MUSE_ACCOUNT_NVS_MOCK_PASS");
}
