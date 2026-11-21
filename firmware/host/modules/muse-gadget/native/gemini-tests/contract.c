/* Deterministic ownership/API tests, not a TLS or scheduler emulator. */
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <errno.h>
#include "esp_http_client.h"
#include "esp_tls_errors.h"
#define ESP_ERR_HTTP_CONNECT 0x7002
#define ESP_ERR_HTTP_WRITE_DATA 0x7003
#define ESP_ERR_NO_MEM 0x101
/* The ESP-IDF API returns the negation of its positive HTTP error constants. */
#undef ESP_ERR_HTTP_EAGAIN
#define ESP_ERR_HTTP_EAGAIN 0x7007
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "../gemini-native-http.h"
static void *cancel_on_full;
static int two_blocks;
static int flood, header_again, read_again, response_status=200;
static unsigned allocations, allocation_fail, live;
static void *allocate(size_t n) {
  if(++allocations==allocation_fail)return NULL;
  void *p=malloc(n); assert(p); live++; return p;
}
static void *zero_allocate(size_t n,size_t size) {void *p=allocate(n*size);if(p)memset(p,0,n*size);return p;}
static void release(void *p) {if(p){assert(live);live--;free(p);}}
void *heap_caps_malloc(size_t size,unsigned caps){assert(caps==(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));return allocate(size);}
void *heap_caps_calloc(size_t n,size_t size,unsigned caps){assert(caps==(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)||caps==(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT));if(caps&MALLOC_CAP_INTERNAL)assert(n*size<1024);return zero_allocate(n,size);}
void heap_caps_free(void *p){release(p);}
typedef StaticQueue_t Queue;
QueueHandle_t xQueueCreateStatic(unsigned n,size_t size,unsigned char *storage,StaticQueue_t *q){assert(n==2&&storage&&q);q->size=size;q->count=0;q->bytes=storage;q->is_static=1;return q;}
QueueHandle_t xQueueCreate(unsigned n,size_t size) {
  assert(n==2); Queue *q=allocate(sizeof(*q)+n*size); if(!q)return NULL;
  q->size=size;q->count=0;q->bytes=(void *)(q+1);q->is_static=0;return q;
}
int xQueueSend(QueueHandle_t p,const void *b,int ticks) {
  (void)ticks;Queue *q=p;if(q->count==2){
    assert(cancel_on_full);gemini_native_close(cancel_on_full);cancel_on_full=NULL;return 0;
  }
  memcpy(q->bytes+q->size*q->count++,b,q->size);return 1;
}
int xQueueReceive(QueueHandle_t p,void *b,int ticks) {
  (void)ticks;Queue *q=p;if(!q->count)return 0;
  memcpy(b,q->bytes,q->size);memmove(q->bytes,q->bytes+q->size,--q->count*q->size);return 1;
}
void vQueueDelete(QueueHandle_t p){if(!((Queue *)p)->is_static)release(p);}
SemaphoreHandle_t xSemaphoreCreateMutex(void){return allocate(1);}
int xSemaphoreTake(SemaphoreHandle_t p,int ticks){assert(p);(void)ticks;return 1;}
int xSemaphoreGive(SemaphoreHandle_t p){assert(p);return 1;}
void vSemaphoreDelete(SemaphoreHandle_t p){release(p);}
static void (*task)(void *),(*watchdog)(void *);
static void *task_arg,*watchdog_arg;
static int task_fail,watchdog_fail;
int xTaskCreate(void (*fn)(void *),const char *name,unsigned stack,void *arg,unsigned priority,void *handle) {
  (void)stack;(void)priority;(void)handle;
  if(!strcmp(name,"gemini-stop")){if(watchdog_fail)return 0;watchdog=fn;watchdog_arg=arg;}
  else {assert(!strcmp(name,"gemini-tls"));if(task_fail)return 0;task=fn;task_arg=arg;}
  return 1;
}
void vTaskDelete(void *p){assert(!p);}
void vTaskDelay(int ticks){(void)ticks;assert(!"unexpected scheduler wait");}
static time_t wall=1800000000;
static int64_t now;
time_t time(time_t *p){if(p)*p=wall;return wall;}
int64_t esp_timer_get_time(void){return now;}
static int logs,refuse_log_suppression,requests,cleaned,read_count,network_failure;
static int fake_tls_error,fake_open_error,fake_errno,fake_socket=8;
int esp_log_level_get(const char *tag){(void)tag;return logs;}
void esp_log_level_set(const char *tag,int level){(void)tag;if(!refuse_log_suppression)logs=level;}
esp_err_t esp_crt_bundle_attach(void *p){(void)p;return 0;}
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *c){
  assert(c->crt_bundle_attach==esp_crt_bundle_attach && !c->skip_cert_common_name_check);
  assert(c->disable_auto_redirect && c->transport_type==HTTP_TRANSPORT_OVER_SSL);
  requests++; read_count=0;return (void *)1;
}
esp_err_t esp_http_client_set_header(void *h,const char *k,const char *v){assert(h&&k&&v);return 0;}
esp_err_t esp_http_client_delete_header(void *h,const char *k){assert(h&&!strcmp(k,"x-goog-api-key"));return 0;}
esp_err_t esp_http_client_get_and_clear_last_tls_error(void *h,int *code,int *flags){assert(h);*code=0;*flags=network_failure==1;return network_failure==2 ? ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED : fake_tls_error;}
esp_err_t esp_http_client_close(void *h){assert(h);return 0;}
esp_err_t esp_http_client_cleanup(void *h){assert(h);cleaned++;return 0;}
int esp_http_client_open(void *h,int n){assert(h&&n>0);assert(!watchdog);return network_failure==1 || network_failure==2 ? -1 : fake_open_error;}
int esp_http_client_write(void *h,const char *p,int n){assert(h&&p&&n>0);return n>1?1:n;}
int64_t esp_http_client_fetch_headers(void *h){assert(h);if(header_again){header_again=0;return -ESP_ERR_HTTP_EAGAIN;}return 3;}
int esp_http_client_get_status_code(void *h){assert(h);return response_status;}
int esp_http_client_get_socket(void *h){assert(h);return fake_socket;}
int esp_http_client_get_errno(void *h){assert(h);return fake_errno;}
int esp_http_client_set_timeout_ms(void *h,int n){assert(h&&n>0);return 0;}
int esp_http_client_read(void *h,char *b,int n){assert(h&&n>=3);if(read_again){read_again=0;return -ESP_ERR_HTTP_EAGAIN;}if(read_count++ >= (flood ? 3 : two_blocks ? 2 : 1))return 0;memcpy(b,read_count==1 ? "abc" : "XYZ",3);return 3;}
bool esp_http_client_is_complete_data_received(void *h){assert(h);return true;}
#define malloc allocate
#define calloc zero_allocate
#define free release
#include "../gemini-native-http.c"
#undef malloc
#undef calloc
#undef free
static void run(void) {
  assert(task);void (*fn)(void *)=task;void *arg=task_arg;task=NULL;fn(arg);
  if(watchdog){fn=watchdog;arg=watchdog_arg;watchdog=NULL;fn(arg);}
}
static void *create(void){return gemini_native_create("https://generativelanguage.googleapis.com/v1beta/interactions","fixture.synthetic.key_12345","{}",2,45000);}
static void cycle(void){unsigned char b[4096];void *p=create();assert(p);assert(gemini_native_read(p,b,sizeof(b))==-2);run();assert(gemini_native_diagnostic(p)==8000200);assert(gemini_native_read(p,b,sizeof(b))==3&&!memcmp(b,"abc",3));assert(gemini_native_read(p,b,sizeof(b))==0);gemini_native_close(p);assert(!live);}
int main(void) {
  unsigned char b[4096];
  int reason=0;
  assert(!gemini_native_create_diagnostic(gemini_url,"too_short","{}",2,45000,&reason) && reason==4);
  char boundary_key[514];memset(boundary_key,'.',512);boundary_key[512]=0;
  void *boundary=gemini_native_create_diagnostic(gemini_url,boundary_key,"{}",2,45000,&reason);assert(boundary && !reason);run();gemini_native_close(boundary);assert(!live);
  boundary_key[512]='.';boundary_key[513]=0;assert(!gemini_native_create_diagnostic(gemini_url,boundary_key,"{}",2,45000,&reason) && reason==4);
  requests=cleaned=0;
  assert(!gemini_native_create("https://example.com","fixture","{}",2,45000));
  assert(!gemini_native_create(gemini_url,"bad\r\nkey","{}",2,45000));
  assert(!gemini_native_create(gemini_url,"","{}",2,45000));
  assert(!gemini_native_create(gemini_url,"fixture","{}",0,45000));
  assert(!gemini_native_create(gemini_url,"fixture","{}",32769,45000));
  assert(!gemini_native_create(gemini_url,"fixture","{}",2,999));
  wall=0;assert(!create());wall=1800000000;
  logs=3;refuse_log_suppression=1;assert(!create());refuse_log_suppression=0;
  assert(!requests&&!live);cycle();
  for(unsigned i=1;i<=4;i++){allocations=0;allocation_fail=i;assert(!create());assert(!live);allocation_fail=0;cycle();}
  task_fail=1;assert(!create());assert(!live);task_fail=0;cycle();
  watchdog_fail=1;void *p=create();assert(p);run();assert(gemini_native_read(p,b,sizeof(b))==-4);gemini_native_close(p);assert(!live);watchdog_fail=0;cycle();
  p=create();assert(p&&!create());gemini_native_close(p);run();assert(!live);cycle();
  p=create();assert(p);now+=46000000;run();assert(gemini_native_read(p,b,sizeof(b))==-3);gemini_native_close(p);assert(!live);cycle();
  p=create();assert(p);run();void *next=create();assert(next);gemini_native_close(p);run();gemini_native_close(next);assert(!live);
  flood=1;p=create();assert(p);cancel_on_full=p;run();assert(!live&&!cancel_on_full);flood=0;cycle();
  header_again=1;read_again=1;cycle();assert(!header_again&&!read_again);
  response_status=302;p=create();assert(p);int before=requests;run();assert(requests==before+1 && gemini_native_read(p,b,sizeof(b))==-1);gemini_native_close(p);assert(!live);response_status=200;cycle();
  const int expected_diagnostic[]={4005000,4006000,6009403};
  for(network_failure=1;network_failure<=3;network_failure++){response_status=network_failure==3 ? 403 : 200;p=create();assert(p);run();assert(gemini_native_read(p,b,sizeof(b))==-1);assert(gemini_native_diagnostic(p)==expected_diagnostic[network_failure-1]);gemini_native_close(p);assert(!live);}
  network_failure=0;response_status=200;cycle();
  fake_socket=-1;p=create();assert(p);run();assert(gemini_native_read(p,b,sizeof(b))==-1);assert(gemini_native_diagnostic(p)==4010000);assert(gemini_native_transport_diagnostic(p)==100);gemini_native_close(p);fake_socket=8;
  const int tls_cases[][2]={
    {ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME,11},{ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET,12},
    {ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST,13},{ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT,14},
    {ESP_ERR_MBEDTLS_SSL_SETUP_FAILED,15},{ESP_ERR_MBEDTLS_SSL_WRITE_FAILED,16},
    {ESP_ERR_NO_MEM,4}};
  fake_open_error=ESP_ERR_HTTP_CONNECT;
  for(unsigned i=0;i<sizeof(tls_cases)/sizeof(tls_cases[0]);i++){
    fake_tls_error=tls_cases[i][0];p=create();assert(p);run();
    assert(gemini_native_read(p,b,sizeof(b))==-1);
    assert(gemini_native_diagnostic(p)==4000000+1000*tls_cases[i][1]);
    assert(gemini_native_transport_diagnostic(p)==200);gemini_native_close(p);assert(!live);
  }
  fake_tls_error=0;
  const int open_cases[][3]={{ESP_ERR_HTTP_CONNECT,2,13},{ESP_ERR_HTTP_WRITE_DATA,3,16},{ESP_ERR_HTTP_INVALID_TRANSPORT,4,17},{ESP_ERR_NO_MEM,5,4},{-123,6,1}};
  for(unsigned i=0;i<sizeof(open_cases)/sizeof(open_cases[0]);i++){
    fake_open_error=open_cases[i][0];p=create();assert(p);run();
    assert(gemini_native_diagnostic(p)==4000000+1000*open_cases[i][2]);
    assert(gemini_native_transport_diagnostic(p)==100*open_cases[i][1]);gemini_native_close(p);assert(!live);
  }
  const int errno_cases[]={0,ETIMEDOUT,ECONNREFUSED,ECONNRESET,ENETUNREACH,EHOSTUNREACH,ENOMEM,-123};
  fake_open_error=ESP_ERR_HTTP_CONNECT;
  for(unsigned i=0;i<sizeof(errno_cases)/sizeof(errno_cases[0]);i++){
    fake_errno=errno_cases[i];p=create();assert(p);run();
    assert(gemini_native_transport_diagnostic(p)==200+(int)i);gemini_native_close(p);assert(!live);
  }
  fake_open_error=fake_errno=0;cycle();
  /* Both queued copies survive producer zeroization; consumer scratch cannot alias them. */
  two_blocks=1;p=create();assert(p);run();
  assert(gemini_native_read(p,b,sizeof(b))==3&&!memcmp(b,"abc",3));
  assert(gemini_native_read(p,b,sizeof(b))==3&&!memcmp(b,"XYZ",3));
  assert(gemini_native_read(p,b,sizeof(b))==0);gemini_native_close(p);assert(!live);two_blocks=0;
  gemini_native_close(NULL);assert(requests==cleaned);puts("GEMINI_NATIVE_CONTRACT_PASS");
}
