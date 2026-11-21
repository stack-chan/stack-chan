#include "../account-http.h"
#include "esp_http_client.h"
#include "esp_tls_errors.h"
#include "esp_crt_bundle.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
static time_t wall=1800000000;
time_t time(time_t *p) { if (p) *p=wall; return wall; }
static esp_http_client_config_t cfg;
static int mode,created,cleaned,performed,deleted,loglevel;
static atomic_bool cancel;
static int64_t now;
static int lastTLS, tlsFlags, tlsCalls;
esp_err_t esp_http_client_get_and_clear_last_tls_error(esp_http_client_handle_t h,int *code,int *flags) {
  assert(h==&cfg); tlsCalls++; *code=-12345; *flags=tlsFlags; return lastTLS;
}
int64_t esp_timer_get_time(void) { return now; }
void vTaskDelay(int ticks) { assert(ticks==1); now+=5000000; }
int esp_log_level_get(const char *tag) { assert(!strcmp(tag,"HTTP_CLIENT") || !strcmp(tag,"HTTP_HEADER")); return loglevel; }
esp_err_t esp_crt_bundle_attach(void *p) { (void)p; return 0; }
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *c) {
  assert(c->crt_bundle_attach==esp_crt_bundle_attach && c->transport_type==HTTP_TRANSPORT_OVER_SSL);
  assert(!c->skip_cert_common_name_check && c->disable_auto_redirect && c->timeout_ms==15000 && c->max_authorization_retries==-1 && c->is_async);
  assert(!strcmp(c->url,"https://api.muse.ai/fetch_vms") || !strcmp(c->url,"https://api.muse.ai/device_token/refresh"));
  cfg=*c; created++; return &cfg;
}
esp_err_t esp_http_client_set_header(esp_http_client_handle_t h,const char *k,const char *v) {
  assert(h==&cfg && k && v); return mode==7 ? -1 : 0;
}
esp_err_t esp_http_client_delete_header(esp_http_client_handle_t h,const char *k) { assert(h==&cfg && !strcmp(k,"Authorization")); deleted++; return 0; }
esp_err_t esp_http_client_set_post_field(esp_http_client_handle_t h,const char *p,int n) { assert(h==&cfg && p && n>0); return 0; }
esp_err_t esp_http_client_perform(esp_http_client_handle_t h) {
  assert(h==&cfg); performed++;
  if (mode==8) return ESP_ERR_HTTP_EAGAIN;
  if (mode==9) return ESP_ERR_HTTP_INVALID_TRANSPORT;
  char bytes[32]; memset(bytes,'a',sizeof(bytes));
  esp_http_client_event_t e={.event_id=HTTP_EVENT_ON_DATA,.data=bytes,.data_len=2,.user_data=cfg.user_data};
  if (mode==1) { e.event_id=HTTP_EVENT_REDIRECT; assert(cfg.event_handler(&e)==ESP_FAIL); return 0; }
  if (mode==2) e.data_len=32;
  if (mode==3) e.data_len=-1;
  if (mode==4) atomic_store(&cancel,true);
  int r=cfg.event_handler(&e);
  if (mode>=2 && mode<=4) assert(r==ESP_FAIL); else assert(r==ESP_OK);
  return mode==5 || mode==6 ? ESP_FAIL : ESP_OK;
}
int esp_http_client_get_status_code(esp_http_client_handle_t h) { assert(h==&cfg); return mode==1 ? 302 : mode==6 ? 401 : 200; }
esp_err_t esp_http_client_cleanup(esp_http_client_handle_t h) { assert(h==&cfg); cleaned++; return 0; }
esp_err_t esp_http_client_close(esp_http_client_handle_t h) { assert(h==&cfg); return 0; }
int main(void) {
  char out[16]; size_t length; int status; bool redirected;
  MuseAccountHTTPContext context={.cancelled=&cancel};
  loglevel=3;
  assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(!created); loglevel=0;
  assert(context.reason==MA_HTTP_PRIVACY);
  wall=0;
  assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(!created); wall=1800000000;
  assert(context.reason==MA_HTTP_CLOCK);
  assert(!muse_account_http(&context,"http://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(!muse_account_http(&context,"https://api.muse.ai","/device_token/mint","POST","Bearer fixture","{}",out,sizeof(out),&length,&status,&redirected));
  assert(!created);
  for (mode=0;mode<=7;mode++) {
    created=cleaned=performed=deleted=0; atomic_store(&cancel,false); memset(out,42,sizeof(out));
    bool ok=muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected);
    assert(ok==(mode==0 || mode==6));
    MuseAccountHTTPReason expected[]={MA_HTTP_NONE,MA_HTTP_REDIRECT,MA_HTTP_RESPONSE,MA_HTTP_RESPONSE,MA_HTTP_CANCEL,MA_HTTP_TRANSPORT,MA_HTTP_NONE,MA_HTTP_CONFIG};
    assert(context.reason==expected[mode]);
    assert(created==1 && cleaned==1 && deleted==1 && performed==(mode==7 ? 0 : 1));
    if (!ok) { assert(length==0 && status==0); for (size_t i=0;i<sizeof(out);i++) assert(out[i]==0); }
    else assert(length==2 && status==(mode==6 ? 401 : 200));
  }
  mode=0; atomic_store(&cancel,false);
  assert(muse_account_http(&context,"https://api.muse.ai","/device_token/refresh","POST","Bearer hatch_refresh:fixture","{\"device_id\":\"fixture\"}",out,sizeof(out),&length,&status,&redirected));
  mode=8; performed=0; now=0;
  assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(performed==3 && now==15000000);
  assert(context.reason==MA_HTTP_DEADLINE);
  assert(!strcmp(muse_account_http_error(MA_HTTP_TRANSPORT),"account HTTP transport"));
  assert(!strcmp(muse_account_http_error((MuseAccountHTTPReason)999),"account HTTP failed"));
  const int errors[]={ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME,ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET,
    ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST,ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT,
    ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED,ESP_ERR_MBEDTLS_SSL_READ_FAILED,
    ESP_ERR_MBEDTLS_X509_CRT_PARSE_FAILED,ESP_ERR_MBEDTLS_SSL_SETUP_FAILED,123456};
  const MuseAccountHTTPReason reasons[]={MA_HTTP_DNS,MA_HTTP_SOCKET,MA_HTTP_CONNECT,MA_HTTP_CONNECT_TIMEOUT,
    MA_HTTP_HANDSHAKE,MA_HTTP_TLS_IO,MA_HTTP_CERTIFICATE,MA_HTTP_TLS_SETUP,MA_HTTP_TRANSPORT};
  mode=5; now=0;
  for(size_t i=0;i<sizeof(errors)/sizeof(errors[0]);i++) {
    lastTLS=errors[i]; tlsCalls=0; memset(out,42,sizeof(out));
    assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
    assert(context.reason==reasons[i] && tlsCalls==1 && length==0 && status==0);
    for(size_t j=0;j<sizeof(out);j++)assert(out[j]==0);
  }
  lastTLS=ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED; tlsFlags=1;
  assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(context.reason==MA_HTTP_CERTIFICATE);
  tlsFlags=0; mode=6; tlsCalls=0;
  assert(muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(tlsCalls==0 && status==401);
  mode=9; lastTLS=0; tlsFlags=0; tlsCalls=0;
  assert(!muse_account_http(&context,"https://api.muse.ai","/fetch_vms","GET","Bearer fixture",NULL,out,sizeof(out),&length,&status,&redirected));
  assert(context.reason==MA_HTTP_INVALID_TRANSPORT && tlsCalls==1);
  assert(!strcmp(muse_account_http_error(context.reason),"account HTTP unsupported transport"));
  puts("MUSE_ACCOUNT_HTTP_MOCK_PASS");
}
