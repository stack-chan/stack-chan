#include "account-http.h"
#include "account-session-core.h"
#ifdef ESP_PLATFORM
#include "sdkconfig.h"
#if !CONFIG_ESP_HTTP_CLIENT_ENABLE_HTTPS
#error "Muse account requires the ESP-IDF HTTPS client"
#endif
#endif
#include "esp_http_client.h"
#include "esp_tls_errors.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <stdio.h>
#include <time.h>

typedef struct {
  MuseAccountHTTPContext *context;
  char *bytes;
  size_t capacity, length;
  bool failed, redirected;
} Response;
const char *muse_account_http_error(MuseAccountHTTPReason reason) {
  switch(reason) {
    case MA_HTTP_CLOCK: return "account HTTP clock";
    case MA_HTTP_INPUT: return "account HTTP input";
    case MA_HTTP_PRIVACY: return "account HTTP privacy";
    case MA_HTTP_INIT: return "account HTTP allocation";
    case MA_HTTP_CONFIG: return "account HTTP configuration";
    case MA_HTTP_CANCEL: return "account HTTP cancelled";
    case MA_HTTP_DEADLINE: return "account HTTP deadline";
    case MA_HTTP_REDIRECT: return "account HTTP redirect";
    case MA_HTTP_RESPONSE: return "account HTTP response limit";
    case MA_HTTP_TRANSPORT: return "account HTTP transport";
    case MA_HTTP_DNS: return "account HTTP DNS";
    case MA_HTTP_SOCKET: return "account HTTP socket";
    case MA_HTTP_CONNECT: return "account HTTP connect";
    case MA_HTTP_CONNECT_TIMEOUT: return "account HTTP connect timeout";
    case MA_HTTP_CERTIFICATE: return "account HTTP certificate";
    case MA_HTTP_HANDSHAKE: return "account HTTP TLS handshake";
    case MA_HTTP_TLS_IO: return "account HTTP TLS IO";
    case MA_HTTP_TLS_SETUP: return "account HTTP TLS setup";
    case MA_HTTP_INVALID_TRANSPORT: return "account HTTP unsupported transport";
    case MA_HTTP_SDK_UNAVAILABLE: return "account HTTP SDK unavailable";
    default: return "account HTTP failed";
  }
}
static MuseAccountHTTPReason transportFailure(esp_http_client_handle_t client,esp_err_t result) {
  int tlsCode=0, flags=0;
  esp_err_t error=esp_http_client_get_and_clear_last_tls_error(client,&tlsCode,&flags);
  if (flags) return MA_HTTP_CERTIFICATE;
  switch(error) {
    case ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME: return MA_HTTP_DNS;
    case ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET:
    case ESP_ERR_ESP_TLS_UNSUPPORTED_PROTOCOL_FAMILY:
    case ESP_ERR_ESP_TLS_SOCKET_SETOPT_FAILED: return MA_HTTP_SOCKET;
    case ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST: return MA_HTTP_CONNECT;
    case ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT: return MA_HTTP_CONNECT_TIMEOUT;
    case ESP_ERR_ESP_TLS_SERVER_HANDSHAKE_TIMEOUT:
    case ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED: return MA_HTTP_HANDSHAKE;
    case ESP_ERR_MBEDTLS_SSL_READ_FAILED:
    case ESP_ERR_MBEDTLS_SSL_WRITE_FAILED: return MA_HTTP_TLS_IO;
    case ESP_ERR_MBEDTLS_X509_CRT_PARSE_FAILED:
    case ESP_ERR_MBEDTLS_CERT_PARTLY_OK: return MA_HTTP_CERTIFICATE;
    case ESP_ERR_MBEDTLS_SSL_SET_HOSTNAME_FAILED:
    case ESP_ERR_MBEDTLS_SSL_CONFIG_DEFAULTS_FAILED:
    case ESP_ERR_MBEDTLS_SSL_SETUP_FAILED: return MA_HTTP_TLS_SETUP;
    default: break;
  }
  if (result==ESP_ERR_HTTP_INVALID_TRANSPORT) return MA_HTTP_INVALID_TRANSPORT;
  return MA_HTTP_TRANSPORT;
}
static bool reject(MuseAccountHTTPContext *c,MuseAccountHTTPReason reason) {
  if(c)c->reason=reason;
  return false;
}
static bool cancelled(MuseAccountHTTPContext *c) { return c && c->cancelled && atomic_load(c->cancelled); }
static esp_err_t event(esp_http_client_event_t *e) {
  Response *r=e->user_data;
  if (!r) return ESP_FAIL;
  if (cancelled(r->context)) r->failed=true;
  if (e->event_id==HTTP_EVENT_REDIRECT) { r->failed=true; r->redirected=true; }
  if (r->failed) return ESP_FAIL;
  if (e->event_id==HTTP_EVENT_ON_DATA) {
    if (e->data_len<0 || (size_t)e->data_len>r->capacity-r->length || (e->data_len && !e->data)) { r->failed=true; return ESP_FAIL; }
    if (e->data_len) memcpy(r->bytes+r->length,e->data,(size_t)e->data_len);
    r->length+=(size_t)e->data_len;
  }
  return ESP_OK;
}
bool muse_account_http(void *context,const char *origin,const char *path,const char *method,const char *authorization,const char *body,char *response,size_t capacity,size_t *length,int *status,bool *redirected) {
  if (!length || !status || !redirected) return false;
  *length=0; *status=0; *redirected=false;
  MuseAccountHTTPContext *ctx=context;
  if (ctx) ctx->reason=MA_HTTP_NONE;
  if (time(NULL)<1704067200) return reject(ctx,MA_HTTP_CLOCK);
  if (cancelled(ctx)) return reject(ctx,MA_HTTP_CANCEL);
  if (!origin || strcmp(origin,MUSE_ACCOUNT_ORIGIN) || !path || !method || !authorization || !response || !capacity || capacity>MUSE_ACCOUNT_RESPONSE_MAX) return reject(ctx,MA_HTTP_INPUT);
  bool refresh=!strcmp(path,"/device_token/refresh");
  if (refresh ? strcmp(method,"POST") || !body || strlen(body)>256 : strcmp(path,"/fetch_vms") || strcmp(method,"GET") || body) return reject(ctx,MA_HTTP_INPUT);
  size_t auth_size=strlen(authorization);
  if (auth_size<=7 || auth_size>=2080 || strncmp(authorization,"Bearer ",7)) return reject(ctx,MA_HTTP_INPUT);
  for (size_t i=0;i<auth_size;i++) if ((unsigned char)authorization[i]<32 || (unsigned char)authorization[i]>=127) return reject(ctx,MA_HTTP_INPUT);
  /* ESP-IDFのHTTP_CLIENTはdebug時にAuthorizationを含むheader全文を出力する */
  if (esp_log_level_get("HTTP_CLIENT")!=ESP_LOG_NONE || esp_log_level_get("HTTP_HEADER")!=ESP_LOG_NONE) return reject(ctx,MA_HTTP_PRIVACY);
  char url[96];
  int n=snprintf(url,sizeof(url),"%s%s",MUSE_ACCOUNT_ORIGIN,path);
  if (n<0 || n>=(int)sizeof(url)) return reject(ctx,MA_HTTP_INPUT);
  Response r={.context=ctx,.bytes=response,.capacity=capacity};
  esp_http_client_config_t cfg={
    .url=url, .method=refresh ? HTTP_METHOD_POST : HTTP_METHOD_GET,
    .timeout_ms=15000, .buffer_size=1024, .buffer_size_tx=4096,
    .event_handler=event, .user_data=&r, .crt_bundle_attach=esp_crt_bundle_attach,
    .transport_type=HTTP_TRANSPORT_OVER_SSL, .skip_cert_common_name_check=false,
    .disable_auto_redirect=true, .max_authorization_retries=-1, .is_async=true,
  };
  esp_http_client_handle_t client=esp_http_client_init(&cfg); if (!client) return reject(ctx,MA_HTTP_INIT);
  bool ok=false;
  MuseAccountHTTPReason failure=MA_HTTP_CONFIG;
  if (esp_http_client_set_header(client,"Authorization",authorization)!=ESP_OK ||
      esp_http_client_set_header(client,"X-API-Version","1.0.0")!=ESP_OK) goto done;
  if (body && (esp_http_client_set_header(client,"Content-Type","application/json")!=ESP_OK ||
      esp_http_client_set_post_field(client,body,(int)strlen(body))!=ESP_OK)) goto done;
  if (cancelled(ctx)) { failure=MA_HTTP_CANCEL; goto done; }
  int64_t deadline=ctx && ctx->deadline_us ? ctx->deadline_us : esp_timer_get_time()+15000000;
  esp_err_t result;
  do {
    if (cancelled(ctx)) { failure=MA_HTTP_CANCEL; goto done; }
    if (esp_timer_get_time()>=deadline) { failure=MA_HTTP_DEADLINE; goto done; }
    if (r.failed) { failure=r.redirected ? MA_HTTP_REDIRECT : MA_HTTP_RESPONSE; goto done; }
    result=esp_http_client_perform(client);
    if (result==ESP_ERR_HTTP_EAGAIN) vTaskDelay(1);
  } while (result==ESP_ERR_HTTP_EAGAIN);
  int code=esp_http_client_get_status_code(client);
  *redirected=r.redirected || (code>=300 && code<400);
  if (cancelled(ctx)) { failure=MA_HTTP_CANCEL; goto done; }
  if (*redirected) { failure=MA_HTTP_REDIRECT; goto done; }
  if (r.failed) { failure=MA_HTTP_RESPONSE; goto done; }
  if (esp_timer_get_time()>=deadline) { failure=MA_HTTP_DEADLINE; goto done; }
  if (result!=ESP_OK && code!=401 && code!=403) { failure=transportFailure(client,result); goto done; }
  *length=r.length; *status=code; ok=true;
done:
  esp_http_client_close(client);
  esp_http_client_delete_header(client,"Authorization");
  esp_http_client_cleanup(client);
  if (!ok) { reject(ctx,failure); volatile char *p=response; for (size_t i=0;i<capacity;i++) p[i]=0; *length=0; *status=0; }
  return ok;
}
