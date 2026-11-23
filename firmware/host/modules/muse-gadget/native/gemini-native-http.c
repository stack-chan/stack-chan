#include "gemini-native-http.h"
#include "esp_http_client.h"
#include "esp_tls_errors.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include <sys/socket.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <errno.h>

#define GEMINI_READ_SIZE 4096
#define GEMINI_RESPONSE_LIMIT (4U * 1024U * 1024U)
static const char gemini_url[] = "https://generativelanguage.googleapis.com/v1beta/interactions";
typedef struct { int length; unsigned char bytes[GEMINI_READ_SIZE]; } GeminiBlock;
typedef struct {
  GeminiBlock scratch;
  GeminiBlock producer;
  GeminiBlock ring[2];
} GeminiData;
typedef struct {
  atomic_uint references;
  atomic_bool cancelled;
  atomic_bool finished;
  atomic_int outcome;
  atomic_int stage, reason, http_status, transport_detail;
  SemaphoreHandle_t socket_lock;
  int socket;
  QueueHandle_t queue;
  StaticQueue_t queue_control;
  GeminiData *data;
  unsigned char *body;
  size_t body_size;
  char key[513];
  int64_t deadline;
} GeminiNative;
/* A cancelled worker may disappear before TLS returns. No XS pointers cross into this task. */
static atomic_bool gemini_active;
static void gemini_wipe(void *p, size_t n) { volatile unsigned char *s=p; while(n--) *s++=0; }
static void gemini_release(GeminiNative *s) {
  if (atomic_fetch_sub(&s->references, 1)!=1) return;
  while(xQueueReceive(s->queue,&s->data->scratch,0)==pdTRUE) {}
  vQueueDelete(s->queue);
  vSemaphoreDelete(s->socket_lock);
  gemini_wipe(s->data,sizeof(*s->data));
  heap_caps_free(s->data);
  gemini_wipe(s, sizeof(*s));
  heap_caps_free(s);
}
static int gemini_stopped(GeminiNative *s) {
  if (atomic_load(&s->cancelled)) return -1;
  return esp_timer_get_time() >= s->deadline ? -3 : 0;
}
static bool gemini_enqueue(GeminiNative *s, const GeminiBlock *b) {
  while (!atomic_load(&s->cancelled)) {
    if (xQueueSend(s->queue,b,pdMS_TO_TICKS(10))==pdTRUE) return true;
    if (esp_timer_get_time()>=s->deadline) return false;
  }
  return false;
}
/* shutdown interrupts a dripped response without freeing TLS state. The lock
 * excludes close/reuse of this descriptor until shutdown has returned. */
static void gemini_watchdog(void *arg) {
  GeminiNative *s=arg;
  while(!atomic_load(&s->finished)) {
    if(gemini_stopped(s)) {
      xSemaphoreTake(s->socket_lock,portMAX_DELAY);
      if(s->socket>=0) { shutdown(s->socket,SHUT_RDWR); s->socket=-1; }
      xSemaphoreGive(s->socket_lock);
    }
    vTaskDelay(pdMS_TO_TICKS(10) ? pdMS_TO_TICKS(10) : 1);
  }
  gemini_release(s);
  vTaskDelete(NULL);
}
/* Classify SDK/socket failures without preserving server strings or raw error payloads. */
static int gemini_errno_class(int error) {
  switch(error) {
    case 0: return 0;
    case ETIMEDOUT: return 1;
    case ECONNREFUSED: return 2;
    case ECONNRESET: return 3;
    case ENETUNREACH: return 4;
    case EHOSTUNREACH: return 5;
    case ENOMEM: case ENOBUFS: return 6;
    default: return 7;
  }
}
static int gemini_open_class(esp_err_t error) {
  switch(error) {
    case ESP_OK: return 1;
    case ESP_ERR_HTTP_CONNECT: return 2;
    case ESP_ERR_HTTP_WRITE_DATA: return 3;
    case ESP_ERR_HTTP_INVALID_TRANSPORT: return 4;
    case ESP_ERR_NO_MEM: return 5;
    default: return 6;
  }
}
static int gemini_transport_reason(esp_http_client_handle_t h,esp_err_t open_result) {
  int tls=0,flags=0;
  int error=h ? esp_http_client_get_and_clear_last_tls_error(h,&tls,&flags) : 0;
  if(flags)return 5;
  switch(error) {
    case ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME: return 11;
    case ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET:
    case ESP_ERR_ESP_TLS_UNSUPPORTED_PROTOCOL_FAMILY:
    case ESP_ERR_ESP_TLS_SOCKET_SETOPT_FAILED: return 12;
    case ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST: return 13;
    case ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT: return 14;
    case ESP_ERR_ESP_TLS_SERVER_HANDSHAKE_TIMEOUT:
    case ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED: return 6;
    case ESP_ERR_MBEDTLS_X509_CRT_PARSE_FAILED:
    case ESP_ERR_MBEDTLS_CERT_PARTLY_OK: return 5;
    case ESP_ERR_MBEDTLS_SSL_SET_HOSTNAME_FAILED:
    case ESP_ERR_MBEDTLS_SSL_CONFIG_DEFAULTS_FAILED:
    case ESP_ERR_MBEDTLS_SSL_SETUP_FAILED: return 15;
    case ESP_ERR_MBEDTLS_SSL_READ_FAILED:
    case ESP_ERR_MBEDTLS_SSL_WRITE_FAILED: return 16;
    case ESP_ERR_NO_MEM: return 4;
    default: break;
  }
  if(open_result==ESP_ERR_HTTP_CONNECT)return 13;
  if(open_result==ESP_ERR_HTTP_WRITE_DATA)return 16;
  if(open_result==ESP_ERR_HTTP_INVALID_TRANSPORT)return 17;
  if(open_result==ESP_ERR_NO_MEM)return 4;
  return 1;
}
static void gemini_task(void *arg) {
  GeminiNative *s=arg;
  GeminiBlock *block=&s->data->producer;
  esp_http_client_handle_t h=NULL;
  int result=-1;
  esp_err_t open_result=ESP_OK;
  unsigned received=0;
  atomic_store(&s->stage,2);

  esp_http_client_config_t cfg={
    .url=gemini_url, .method=HTTP_METHOD_POST,
    .crt_bundle_attach=esp_crt_bundle_attach,
    .transport_type=HTTP_TRANSPORT_OVER_SSL,
    .skip_cert_common_name_check=false,
    .disable_auto_redirect=true, .max_authorization_retries=-1,
    .timeout_ms=5000, .buffer_size=4096, .buffer_size_tx=1024,
  };
  if ((result=gemini_stopped(s))) goto done;
  result=-1;
  atomic_store(&s->stage,3);
  h=esp_http_client_init(&cfg);
  if (!h) { result=-4; goto done; }
  if (esp_http_client_set_header(h,"Content-Type","application/json")!=ESP_OK ||
      esp_http_client_set_header(h,"Accept","text/event-stream")!=ESP_OK ||
      esp_http_client_set_header(h,"x-goog-api-key",s->key)!=ESP_OK) goto done;
  gemini_wipe(s->key,sizeof(s->key));
  atomic_store(&s->stage,4);
  open_result=esp_http_client_open(h,(int)s->body_size);
  atomic_store(&s->transport_detail,100*gemini_open_class(open_result));
  if (open_result!=ESP_OK) goto done;
  xSemaphoreTake(s->socket_lock,portMAX_DELAY);
  int socket=esp_http_client_get_socket(h);
  s->socket=socket;
  xSemaphoreGive(s->socket_lock);
  if(socket<0) {atomic_store(&s->reason,10); goto done;}
  if ((result=gemini_stopped(s))) goto done;
  /* Before a socket exists the watchdog cannot interrupt connect. Start it only
   * when useful, retaining that task's reference before it can run. */
  atomic_fetch_add(&s->references,1);
  if(xTaskCreate(gemini_watchdog,"gemini-stop",3072,s,3,NULL)!=pdPASS) {
    gemini_release(s); result=-4; goto done;
  }
  atomic_store(&s->stage,5);
  for (size_t sent=0; sent<s->body_size;) {
    if ((result=gemini_stopped(s))) goto done;
    result=-1;
    int n=esp_http_client_write(h,(const char *)s->body+sent,(int)(s->body_size-sent));
    if(n<=0 || (size_t)n>s->body_size-sent) goto done;
    sent+=(size_t)n;
  }
  gemini_wipe(s->body,s->body_size); heap_caps_free(s->body); s->body=NULL;
  if ((result=gemini_stopped(s))) goto done;
  result=-1;
  atomic_store(&s->stage,6);
  int64_t length;
  do {
    if ((result=gemini_stopped(s))) goto done;
    result=-1;
    length=esp_http_client_fetch_headers(h);
  } while(length == -ESP_ERR_HTTP_EAGAIN);
  int status=esp_http_client_get_status_code(h);
  atomic_store(&s->http_status,status>=100 && status<=599 ? status : 0);
  if(length<0) goto done;
  if(length>GEMINI_RESPONSE_LIMIT) {atomic_store(&s->reason,8); result=-4; goto done;}
  if(status!=200) {atomic_store(&s->reason,9); goto done;}
  atomic_store(&s->stage,7);
  esp_http_client_set_timeout_ms(h,1000);
  while (true) {
    if ((result=gemini_stopped(s))) goto done;
    result=-1;
    int n=esp_http_client_read(h,(char *)block->bytes,sizeof(block->bytes));
    if (n == -ESP_ERR_HTTP_EAGAIN) continue;
    if (n<0) goto done;
    if (n==0) {
      if (!esp_http_client_is_complete_data_received(h)) {atomic_store(&s->reason,7); goto done;}
      result=0; goto done;
    }
    if ((unsigned)n>GEMINI_RESPONSE_LIMIT-received) {atomic_store(&s->reason,8);result=-4; goto done;}
    received+=(unsigned)n;
    block->length=n;
    gemini_wipe(block->bytes+n,sizeof(block->bytes)-(size_t)n);
    if (!gemini_enqueue(s,block)) { result=gemini_stopped(s); if(!result) result=-1; goto done; }
  }
done:
  if(h) atomic_fetch_add(&s->transport_detail,gemini_errno_class(esp_http_client_get_errno(h)));
  if(result==0) atomic_store(&s->stage,8);
  if(atomic_load(&s->cancelled)) atomic_store(&s->reason,2);
  else if(result==-3 || esp_timer_get_time()>=s->deadline) atomic_store(&s->reason,3);
  else if(result==-4 && !atomic_load(&s->reason)) atomic_store(&s->reason,4);
  else if(result<0 && !atomic_load(&s->reason))
    atomic_store(&s->reason,gemini_transport_reason(h,open_result));
  if (h) {
    xSemaphoreTake(s->socket_lock,portMAX_DELAY);
    s->socket=-1;
    esp_http_client_delete_header(h,"x-goog-api-key");
    esp_http_client_close(h);
    esp_http_client_cleanup(h);
    xSemaphoreGive(s->socket_lock);
  }
  atomic_store(&s->finished,true);
  if (s->body) {gemini_wipe(s->body,s->body_size); heap_caps_free(s->body); s->body=NULL;}
  gemini_wipe(s->key,sizeof(s->key));
  if (result!=-3 && esp_timer_get_time()>=s->deadline) result=-3;
  gemini_wipe(block,sizeof(*block));
  /* Publish EOF only after releasing the network gate; the next segment may start immediately. */
  atomic_store(&gemini_active,false);
  atomic_store(&s->outcome,result);
  gemini_release(s);
  vTaskDelete(NULL);
}
void *gemini_native_create_diagnostic(const char *url,const char *key,const void *body,size_t size,int timeout,int *reason) {
  int ignored; if(!reason)reason=&ignored; *reason=1;
  if (!url || strcmp(url,gemini_url) || !key || !body || !size || size>32768 ||
      timeout<1000 || timeout>120000) return NULL;
  *reason=2; if(time(NULL)<1704067200) return NULL;
  *reason=3;
  esp_log_level_set("HTTP_CLIENT",ESP_LOG_NONE);
  esp_log_level_set("HTTP_HEADER",ESP_LOG_NONE);
  if (esp_log_level_get("HTTP_CLIENT")!=ESP_LOG_NONE || esp_log_level_get("HTTP_HEADER")!=ESP_LOG_NONE) return NULL;
  *reason=4;
  size_t n=strnlen(key,513);
  if(n<20 || n>512) return NULL;
  for(size_t i=0;i<n;i++) {
    unsigned char c=(unsigned char)key[i];
    if(c<33 || c>126) return NULL;
  }
  /* Bound outstanding network work even when a replacement job follows cancellation. */
  *reason=5;
  bool expected=false;
  if(!atomic_compare_exchange_strong(&gemini_active,&expected,true)) return NULL;
  *reason=6;
  GeminiNative *s=heap_caps_calloc(1,sizeof(*s),MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);
  if(!s) goto fail;
  /* The XS handle and TLS task each own one reference. */
  atomic_init(&s->references,2); atomic_init(&s->cancelled,false);
  atomic_init(&s->transport_detail,0); atomic_init(&s->stage,1); atomic_init(&s->reason,0); atomic_init(&s->http_status,0);
  atomic_init(&s->finished,false); atomic_init(&s->outcome,-2); s->socket=-1;
  /* Keep scheduler/atomic control internal; only bounded bulk payload lives in PSRAM. */
  s->data=heap_caps_calloc(1,sizeof(*s->data),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  if(!s->data) goto fail;
  s->socket_lock=xSemaphoreCreateMutex();
  s->queue=xQueueCreateStatic(2,sizeof(GeminiBlock),(uint8_t *)s->data->ring,&s->queue_control);
  s->body=heap_caps_malloc(size,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  if(!s->queue || !s->body || !s->socket_lock) goto fail;
  memcpy(s->key,key,n); memcpy(s->body,body,size); s->body_size=size;
  s->deadline=esp_timer_get_time()+(int64_t)timeout*1000;
  *reason=7;
  if(xTaskCreate(gemini_task,"gemini-tls",12288,s,3,NULL)!=pdPASS) goto fail;
  *reason=0;
  return s;
fail:
  if(s) {
    if(s->queue)vQueueDelete(s->queue);
    if(s->socket_lock)vSemaphoreDelete(s->socket_lock);
    if(s->body){gemini_wipe(s->body,size);heap_caps_free(s->body);}
    if(s->data){gemini_wipe(s->data,sizeof(*s->data));heap_caps_free(s->data);}
    gemini_wipe(s,sizeof(*s)); heap_caps_free(s);
  }
  atomic_store(&gemini_active,false);
  return NULL;
}
void *gemini_native_create(const char *url,const char *key,const void *body,size_t size,int timeout) {
  return gemini_native_create_diagnostic(url,key,body,size,timeout,NULL);
}
int gemini_native_diagnostic(void *p) {
  if(!p)return 0;
  GeminiNative *s=p;
  return atomic_load(&s->stage)*1000000 + atomic_load(&s->reason)*1000 + atomic_load(&s->http_status);
}
int gemini_native_transport_diagnostic(void *p) {
  return p ? atomic_load(&((GeminiNative *)p)->transport_detail) : 0;
}
int gemini_native_read(void *p,void *buffer,size_t size) {
  GeminiNative *s=p;
  if(!s || size!=GEMINI_READ_SIZE || !buffer) return -1;
  GeminiBlock *block=&s->data->scratch;
  /* Snapshot before dequeue: an empty queue observed before a final enqueue is not EOF. */
  int outcome=atomic_load(&s->outcome);
  if(xQueueReceive(s->queue,block,0)!=pdTRUE) {
    int stopped=gemini_stopped(s);
    return stopped ? stopped : outcome;
  }
  if(block->length>0) memcpy(buffer,block->bytes,(size_t)block->length);
  int n=block->length; gemini_wipe(block,sizeof(*block)); return n;
}
void gemini_native_close(void *p) {
  if(!p)return;
  GeminiNative *s=p;
  atomic_store(&s->cancelled,true);
  gemini_release(s);
}
