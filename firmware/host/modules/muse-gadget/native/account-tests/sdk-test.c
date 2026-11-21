#include "../sdk-token-store.h"
#include "nvs.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static char stored[80];
static bool exists,namespace_exists;
static int fault,reads,writes,commits,opens,closes;
static bool log_refuses;
static int log_level=3;
void esp_log_level_set(const char *tag,int level) {
  assert(!strcmp(tag,"link.pairing") && level==0);
  if (!log_refuses) log_level=level;
}
int esp_log_level_get(const char *tag) { assert(!strcmp(tag,"link.pairing")); return log_level; }
int nvs_open(const char *ns,int mode,nvs_handle_t *h) {
  assert(!strcmp(ns,"muse_sdk"));
  if (fault==1) return -1;
  if (!namespace_exists && mode==NVS_READONLY) return ESP_ERR_NVS_NOT_FOUND;
  namespace_exists=true; *h=3; opens++; return ESP_OK;
}
void nvs_close(nvs_handle_t h) { assert(h==3); closes++; }
int nvs_get_str(nvs_handle_t h,const char *key,char *out,size_t *size) {
  assert(h==3 && !strcmp(key,"sdk_token"));
  if (!exists) return ESP_ERR_NVS_NOT_FOUND;
  if (fault==2) return ESP_ERR_NVS_TYPE_MISMATCH;
  size_t n=strlen(stored)+1;
  if (out) {
    reads++;
    if (fault==3 || *size<n) return -1;
    memcpy(out,stored,n);
    if (fault==6) out[6]='B';
  }
  *size=n; return ESP_OK;
}
int nvs_set_str(nvs_handle_t h,const char *key,const char *token) {
  assert(h==3 && !strcmp(key,"sdk_token")); writes++;
  if (fault==4) return -1;
  strcpy(stored,token); exists=true; return ESP_OK;
}
int nvs_commit(nvs_handle_t h) { assert(h==3); commits++; return fault==5 ? -1 : ESP_OK; }
static void clear(void) { memset(stored,0,sizeof(stored)); exists=namespace_exists=false; fault=reads=writes=commits=opens=closes=0; }
int main(void) {
  log_refuses=true; assert(!muse_sdk_pairing_privacy());
  log_refuses=false; assert(muse_sdk_pairing_privacy() && log_level==0);
  char fixture[49]; memcpy(fixture,"mgst_",5); memset(fixture+5,'A',43); fixture[48]=0;
  assert(muse_sdk_token_valid(fixture));
  fixture[47]='B'; assert(!muse_sdk_token_valid(fixture)); fixture[47]='A';
  fixture[12]='/'; assert(!muse_sdk_token_valid(fixture)); fixture[12]='A';
  assert(!muse_sdk_token_valid(NULL) && !muse_sdk_token_valid("mgst_short"));
  clear(); assert(muse_sdk_token_presence()==MSDK_ABSENT && reads==0);
  char out[49]; memset(out,42,sizeof(out)); assert(muse_sdk_token_read(out)==MSDK_ABSENT);
  for (size_t i=0;i<sizeof(out);i++) assert(!out[i]);
  assert(muse_sdk_token_store_if_absent_approved(fixture)==MSDK_OK && writes==1 && commits==1);
  int previous_reads=reads; assert(muse_sdk_token_presence()==MSDK_EXISTS && reads==previous_reads);
  assert(muse_sdk_token_store_if_absent_approved(fixture)==MSDK_EXISTS && writes==1);
  assert(muse_sdk_token_read(out)==MSDK_OK && !memcmp(out,fixture,sizeof(out)));
  fault=2; assert(muse_sdk_token_store_if_absent_approved(fixture)==MSDK_EXISTS && writes==1);
  assert(muse_sdk_token_read(out)==MSDK_INVALID);
  for (size_t i=0;i<sizeof(out);i++) assert(!out[i]);
  for (int failure=1;failure<=6;failure++) {
    if (failure==2 || failure==3) continue;
    clear(); fault=failure;
    assert(muse_sdk_token_store_if_absent_approved(fixture)==MSDK_IO);
    assert(opens==closes && writes<=1 && commits<=1);
  }
  clear(); namespace_exists=exists=true; strcpy(stored,"malformed");
  assert(muse_sdk_token_presence()==MSDK_INVALID);
  assert(muse_sdk_token_store_if_absent_approved(fixture)==MSDK_EXISTS && writes==0);
  puts("MUSE_SDK_TOKEN_STORE_MOCK_PASS");
}
