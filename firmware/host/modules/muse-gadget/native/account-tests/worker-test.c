#include "../account-worker.h"
#include "../account-http.h"
#include "../sdk-token-store.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static void (*task)(void *);
static void *argument;
static int fail_create,requests,deleted,logs;
static MuseAccountWorker *active;
static bool cancel_during_http;
static int refresh_mode,sdk_reads;
static MuseSDKResult sdk_result=MSDK_OK;
static const char sdk_fixture[]="mgst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
MuseSDKResult muse_sdk_token_read(char out[MUSE_SDK_TOKEN_LENGTH+1]) {
  sdk_reads++; assert(sizeof(sdk_fixture)==49); strcpy(out,sdk_fixture); return sdk_result;
}
int64_t esp_timer_get_time(void) { return 1; }
void esp_log_level_set(const char *tag,int level) { assert(!strcmp(tag,"HTTP_CLIENT") || !strcmp(tag,"HTTP_HEADER")); assert(!level); logs++; }
int esp_log_level_get(const char *tag) { (void)tag; return 0; }
int xTaskCreate(void (*fn)(void *),const char *name,unsigned stack,void *arg,unsigned priority,void *handle) {
  assert(!strcmp(name,"muse-account") && stack==8192 && priority==5 && !handle);
  if (fail_create) return 0;
  task=fn; argument=arg; return 1;
}
void vTaskDelete(void *h) { assert(!h); deleted++; }
bool muse_account_http(void *ctx,const char *origin,const char *path,const char *method,const char *auth,const char *body,char *out,size_t cap,size_t *length,int *status,bool *redirected) {
  MuseAccountHTTPContext *http=ctx; assert(http->deadline_us==15000001 && !atomic_load(http->cancelled));
  assert(!strcmp(origin,"https://api.muse.ai") && auth);
  bool refresh=!strcmp(path,"/device_token/refresh");
  if(refresh) {
    assert(!strcmp(method,"POST") && body && strstr(body,"\"sdk_token\":\"mgst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\""));
    assert(strstr(body,"\"device_id\":\"device\""));
  } else assert(!strcmp(path,"/fetch_vms") && !strcmp(method,"GET") && !body);
  requests++;
  if (cancel_during_http) muse_account_worker_cancel(active);
  const char *json="{\"vm_list\":[{\"vm_id\":\"fixture\",\"vm_auth_token\":\"test-only\"}]}";
  if(refresh_mode) {
    if(requests==1) { *length=0; *status=401; *redirected=false; return true; }
    if(refresh)json="{\"access_token\":\"new-fixture\",\"refresh_token\":\"new-refresh\"}";
  }
  assert(cap>strlen(json)); strcpy(out,json); *length=strlen(json); *status=200; *redirected=false; return true;
}
bool muse_account_nvs_store(void *ctx,const char *ns,const char *key,const void *b,size_t n) { (void)ctx; assert(!strcmp(ns,"muse_account") && !strcmp(key,"record") && b && n); return true; }
static bool current(void *ctx,uint32_t generation) { (void)ctx; return generation==7; }
static MuseAccount *make(void) {
  const char *j="{\"action\":\"provision_v2\",\"ssid\":\"fixture\",\"password\":\"fixture\",\"access_token\":\"test-only\",\"refresh_token\":\"test-only\",\"token_type\":\"device\"}";
  MuseAccount *a=muse_account_claim(j,strlen(j),7,current,NULL); assert(a);
  assert(muse_account_commit_approved(a,7,muse_account_nvs_store,NULL)==MA_OK); return a;
}
int main(void) {
  MuseAccount *owner=make(); fail_create=1;
  assert(!muse_account_worker_start(&owner,7,"device") && owner); fail_create=0;
  active=muse_account_worker_start(&owner,7,"device"); assert(active && !owner && !muse_account_worker_done(active));
  MuseAccountResult rc;
  assert(!muse_account_worker_take(active,&owner,&rc));
  task(argument); assert(muse_account_worker_done(active));
  assert(muse_account_worker_take(active,&owner,&rc) && owner && rc==MA_OK);
  assert(!muse_account_worker_take(active,&owner,&rc));
  muse_account_worker_release(active); muse_account_close(owner);
  owner=make(); requests=0;
  active=muse_account_worker_start(&owner,7,"device"); assert(active && !owner);
  muse_account_worker_release(active); task(argument); assert(!requests);
  owner=make(); active=muse_account_worker_start(&owner,7,"device"); cancel_during_http=true;
  task(argument); assert(muse_account_worker_take(active,&owner,&rc) && rc==MA_STALE);
  muse_account_worker_release(active); muse_account_close(owner);
  assert(deleted==3 && logs==8);
  assert(sdk_reads==0);
  cancel_during_http=false; refresh_mode=1;
  for(int missing=0;missing<4;missing++) {
    const MuseSDKResult sdk_results[]={MSDK_OK,MSDK_ABSENT,MSDK_INVALID,MSDK_IO};
    sdk_result=sdk_results[missing]; requests=0; sdk_reads=0;
    owner=make(); active=muse_account_worker_start(&owner,7,"device"); assert(active);
    task(argument); assert(muse_account_worker_take(active,&owner,&rc));
    assert(rc==(missing ? MA_HTTP : MA_OK) && sdk_reads==1 && requests==(missing ? 1 : 3));
    if(missing)assert(muse_account_worker_http_reason(active)==MA_HTTP_SDK_UNAVAILABLE);
    muse_account_worker_release(active); muse_account_close(owner);
  }
  puts("MUSE_ACCOUNT_WORKER_MOCK_PASS");
}
