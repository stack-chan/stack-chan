#include "account-worker.h"
#include "account-http.h"
#include "account-nvs.h"
#include "sdk-token-store.h"
#include <stdio.h>
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

struct MuseAccountWorker {
  atomic_uint refs;
  atomic_bool cancelled,done;
  MuseAccount *core;
  uint32_t generation;
  char device[129];
  MuseAccountResult result;
  MuseAccountHTTPContext http;
};
static void drop(MuseAccountWorker *w) {
  if (atomic_fetch_sub(&w->refs,1)==1) {
    muse_account_close(w->core);
    volatile unsigned char *p=(void *)w; for (size_t i=0;i<sizeof(*w);i++) p[i]=0;
    free(w);
  }
}
static bool request(void *ctx,const char *origin,const char *path,const char *method,const char *auth,const char *body,char *out,size_t cap,size_t *length,int *status,bool *redirected) {
  MuseAccountWorker *w=ctx;
  if (strcmp(path,"/device_token/refresh"))
    return muse_account_http(&w->http,origin,path,method,auth,body,out,cap,length,status,redirected);
  char sdk[MUSE_SDK_TOKEN_LENGTH+1]={0}, refreshBody[256]={0};
  bool ok=false;
  if (muse_sdk_token_read(sdk)!=MSDK_OK) {
    w->http.reason=MA_HTTP_SDK_UNAVAILABLE;
    goto done;
  }
  int n=snprintf(refreshBody,sizeof(refreshBody),"{\"device_id\":\"%s\",\"sdk_token\":\"%s\"}",w->device,sdk);
  if (n<0 || (size_t)n>=sizeof(refreshBody)) {
    w->http.reason=MA_HTTP_INPUT;
    goto done;
  }
  ok=muse_account_http(&w->http,origin,path,method,auth,refreshBody,out,cap,length,status,redirected);
done:
  { volatile char *p=sdk; for(size_t i=0;i<sizeof(sdk);i++)p[i]=0; }
  { volatile char *p=refreshBody; for(size_t i=0;i<sizeof(refreshBody);i++)p[i]=0; }
  return ok;
}
static bool store(void *ctx,const char *ns,const char *key,const void *blob,size_t size) {
  MuseAccountWorker *w=ctx;
  if (atomic_load(&w->cancelled) || esp_timer_get_time()>=w->http.deadline_us) return false;
  return muse_account_nvs_store(NULL,ns,key,blob,size);
}
static void run(void *arg) {
  MuseAccountWorker *w=arg;
  w->result=atomic_load(&w->cancelled) ? MA_STALE : muse_account_connect_approved(w->core,w->generation,w->device,request,store,w);
  if (atomic_load(&w->cancelled)) { w->result=MA_STALE; muse_account_invalidate_voice(w->core); }
  atomic_store(&w->done,true);
  drop(w);
  vTaskDelete(NULL);
}
MuseAccountWorker *muse_account_worker_start(MuseAccount **owner,uint32_t generation,const char *device) {
  if (!owner || !*owner || !generation || !device || !*device || strlen(device)>128 ||
      strspn(device,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=strlen(device)) return NULL;
  esp_log_level_set("HTTP_CLIENT",ESP_LOG_NONE); esp_log_level_set("HTTP_HEADER",ESP_LOG_NONE);
  if (esp_log_level_get("HTTP_CLIENT")!=ESP_LOG_NONE || esp_log_level_get("HTTP_HEADER")!=ESP_LOG_NONE) return NULL;
  MuseAccountWorker *w=calloc(1,sizeof(*w)); if (!w) return NULL;
  atomic_init(&w->refs,2); atomic_init(&w->cancelled,false); atomic_init(&w->done,false);
  w->core=*owner; w->generation=generation; strcpy(w->device,device);
  w->http.cancelled=&w->cancelled; w->http.deadline_us=esp_timer_get_time()+15000000;
  *owner=NULL;
  if (xTaskCreate(run,"muse-account",8192,w,5,NULL)!=pdPASS) {
    *owner=w->core; w->core=NULL; drop(w); drop(w); return NULL;
  }
  return w;
}
bool muse_account_worker_done(MuseAccountWorker *w) { return w && atomic_load(&w->done); }
MuseAccountHTTPReason muse_account_worker_http_reason(MuseAccountWorker *w) {
  return w && atomic_load(&w->done) ? w->http.reason : MA_HTTP_NONE;
}
bool muse_account_worker_take(MuseAccountWorker *w,MuseAccount **owner,MuseAccountResult *result) {
  if (!w || !owner || *owner || !result || !atomic_load(&w->done) || !w->core) return false;
  if (atomic_load(&w->cancelled)) { w->result=MA_STALE; muse_account_invalidate_voice(w->core); }
  *owner=w->core; w->core=NULL; *result=w->result; return true;
}
void muse_account_worker_cancel(MuseAccountWorker *w) { if (w) atomic_store(&w->cancelled,true); }
void muse_account_worker_release(MuseAccountWorker *w) { if (w) { muse_account_worker_cancel(w); drop(w); } }
