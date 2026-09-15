// Bounded HTTPS POST on an Espressif task. No exchange or handshake runs in XS.
#include "xsHost.h"
#include "xsmc.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/idf_additions.h"
#include <stdatomic.h>
#include <string.h>
#include <strings.h>
#include <stdlib.h>

#define HTTP_LIMIT 131072
// One active native request across VMs also bounds cancellation overlap.
static atomic_int occupied;
// At most one completed connection can be cached across all VMs.
static atomic_int idleOccupied;
typedef struct {
  atomic_int references, cancelled, done;
  char *url, *headers, *body, *certificate;
  size_t bodySize, headersSize, certificateSize, size, capacity;
  uint8_t *response;
  int timeout, status, error, transportError;
  int64_t deadline;
  bool keepAlive, ownsIdle;
  esp_http_client_handle_t client;
} HttpJob;
typedef struct { HttpJob *job, *idle; } HttpRequest;

static void releaseJob(HttpJob *job) {
  if (atomic_fetch_sub(&job->references, 1) != 1) return;
  if (job->client) esp_http_client_cleanup(job->client);
  if (job->ownsIdle) atomic_store(&idleOccupied, 0);
  free(job->url); free(job->headers); free(job->body);
  free(job->certificate); free(job->response); free(job);
}
static char *copyBytes(const void *bytes, size_t size) {
  char *result = heap_caps_malloc(size + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (result) { if (size) memcpy(result, bytes, size); result[size] = 0; }
  return result;
}
static esp_err_t receiveEvent(esp_http_client_event_t *event) {
  HttpJob *job = event->user_data;
  if (event->event_id != HTTP_EVENT_ON_DATA && event->event_id != HTTP_EVENT_ON_HEADER) return ESP_OK;
  if (atomic_load(&job->cancelled) || esp_timer_get_time() >= job->deadline) job->error = 1;
  if (event->event_id == HTTP_EVENT_ON_HEADER && !strcasecmp(event->header_key, "content-length") &&
      strtoull(event->header_value, NULL, 10) > HTTP_LIMIT) job->error = 2;
  if (!job->error && event->event_id == HTTP_EVENT_ON_DATA && event->data_len > 0) {
    size_t size = job->size + event->data_len;
    if (size > HTTP_LIMIT) job->error = 2;
    else {
      if (size > job->capacity) {
        size_t capacity = job->capacity ? job->capacity : 1024;
        while (capacity < size) capacity *= 2;
        uint8_t *next = heap_caps_realloc(job->response, capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!next) job->error = 3;
        else { job->response = next; job->capacity = capacity; }
      }
      if (!job->error) { memcpy(job->response + job->size, event->data, event->data_len); job->size = size; }
    }
  }
  if (job->error) {
    // esp_http_client does not propagate the ON_DATA handler's return value.
    // Close from this same task; retain the client/parser until perform returns.
    esp_http_client_close(event->client);
    return ESP_FAIL;
  }
  return ESP_OK;
}
static void requestTask(void *argument) {
  HttpJob *job = argument;
  job->deadline = esp_timer_get_time() + (int64_t)job->timeout * 1000;
  esp_http_client_config_t config = {
    .url = job->url, .method = HTTP_METHOD_POST, .transport_type = HTTP_TRANSPORT_OVER_SSL,
    .disable_auto_redirect = true, .is_async = true, .timeout_ms = 1000,
    .event_handler = receiveEvent, .user_data = job,
    .crt_bundle_attach = job->certificate ? NULL : esp_crt_bundle_attach,
    .cert_pem = job->certificate, .cert_len = job->certificateSize,
  };
  esp_http_client_handle_t client = job->client ? job->client : esp_http_client_init(&config);
  job->client = client;
  esp_err_t error = ESP_FAIL;
  if (client) {
    error = ESP_OK;
    for (size_t offset = 0; offset < job->headersSize && error == ESP_OK;) {
      char *name = job->headers + offset;
      size_t length = strnlen(name, job->headersSize - offset);
      if (!length || offset + length + 1 >= job->headersSize) { error = ESP_ERR_INVALID_ARG; break; }
      offset += length + 1;
      char *value = job->headers + offset;
      length = strnlen(value, job->headersSize - offset);
      if (offset + length >= job->headersSize) { error = ESP_ERR_INVALID_ARG; break; }
      error = esp_http_client_set_header(client, name, value);
      offset += length + 1;
    }
    if (error == ESP_OK) error = esp_http_client_set_header(client, "Connection", job->keepAlive ? "keep-alive" : "close");
    // IDF 6's set_post_field returns NOT_FOUND if Content-Type is absent.
    // Supply a neutral default while retaining any caller-provided type.
    if (error == ESP_OK) {
      char *type = NULL;
      esp_http_client_get_header(client, "Content-Type", &type);
      if (!type) error = esp_http_client_set_header(client, "Content-Type", "application/octet-stream");
    }
    if (error == ESP_OK) error = esp_http_client_set_post_field(client, job->body, job->bodySize);
    if (error == ESP_OK) {
      do {
        if (atomic_load(&job->cancelled) || esp_timer_get_time() >= job->deadline) { job->error = 1; break; }
        error = esp_http_client_perform(client);
        if (error == ESP_ERR_HTTP_EAGAIN && !job->error) vTaskDelay(pdMS_TO_TICKS(5));
      } while (error == ESP_ERR_HTTP_EAGAIN && !job->error);
    }
    job->status = esp_http_client_get_status_code(client);
    int expected = 0;
    if (job->keepAlive && !job->error && error == ESP_OK && !atomic_load(&job->cancelled) &&
        atomic_compare_exchange_strong(&idleOccupied, &expected, 1)) job->ownsIdle = true;
    else { esp_http_client_cleanup(client); job->client = NULL; }
  }
  job->transportError = error;
  if (!job->error && error != ESP_OK) {
    job->error = 4;
    ESP_LOGE("live_https", "request failed: %s", esp_err_to_name(error));
  }
  atomic_store(&occupied, 0);
  atomic_store(&job->done, 1);
  releaseJob(job);
  vTaskDeleteWithCaps(NULL);
}
void xs_realtime_http_destructor(void *data) {
  HttpRequest *request = data;
  if (!request) return;
  if (request->job) { atomic_store(&request->job->cancelled, 1); releaseJob(request->job); }
  if (request->idle) releaseJob(request->idle);
  free(request);
}
void xs_realtime_http_constructor(xsMachine *the) {
  HttpRequest *request = calloc(1, sizeof(HttpRequest));
  if (!request) xsUnknownError("Live HTTPS allocation failed");
  xsmcSetHostData(xsThis, request);
}
void xs_realtime_http_start(xsMachine *the) {
  HttpRequest *request = xsmcGetHostData(xsThis);
  if (!request || request->job) xsUnknownError("Live HTTPS request already active");
  if (atomic_load(&occupied)) { xsmcSetBoolean(xsResult, 0); return; }
  // The JS adapter supplies normalized strings and bounded ArrayBuffers.
  const char *url = xsmcToString(xsArg(0));
  size_t urlSize = strlen(url);
  void *body, *headers, *certificate = NULL;
  xsUnsignedValue bodySize, headersSize, certificateSize = 0;
  xsmcGetBufferReadable(xsArg(1), &body, &bodySize);
  xsmcGetBufferReadable(xsArg(2), &headers, &headersSize);
  if (xsmcTest(xsArg(3))) xsmcGetBufferReadable(xsArg(3), &certificate, &certificateSize);
  int timeout = xsmcToInteger(xsArg(4));
  bool keepAlive = xsmcArgc > 5 && xsmcToBoolean(xsArg(5));
  if (urlSize > 4096 || bodySize > HTTP_LIMIT || headersSize > 16384 || certificateSize > 16384 ||
      timeout < 1000 || timeout > 45000) xsRangeError("Live HTTPS request exceeds limit");
  size_t storedCertificateSize = certificateSize + (certificateSize && ((char *)certificate)[0] == '-' ? 1 : 0);
  HttpJob *job = request->idle;
  // Reuse only an identical URL, header set and trust configuration.
  bool reuse = job && keepAlive && !strcmp(job->url, url) && job->headersSize == headersSize &&
    (!headersSize || !memcmp(job->headers, headers, headersSize)) && job->certificateSize == storedCertificateSize &&
    (!certificateSize || !memcmp(job->certificate, certificate, certificateSize));
  if (job && !reuse) { request->idle = NULL; releaseJob(job); job = NULL; }
  if (reuse) {
    char *nextBody = copyBytes(body, bodySize);
    if (!nextBody) xsUnknownError("Live HTTPS allocation failed");
    int expected = 0;
    if (!atomic_compare_exchange_strong(&occupied, &expected, 1)) { free(nextBody); xsmcSetBoolean(xsResult, 0); return; }
    request->idle = NULL;
    job->ownsIdle = false; atomic_store(&idleOccupied, 0);
    free(job->body); job->body = nextBody;
    job->bodySize = bodySize; job->timeout = timeout;
    job->size = 0; job->status = job->error = job->transportError = 0;
    atomic_store(&job->cancelled, 0); atomic_store(&job->done, 0);
  } else {
  job = calloc(1, sizeof(HttpJob));
  if (!job) xsUnknownError("Live HTTPS allocation failed");
  atomic_init(&job->references, 1);
  atomic_init(&job->cancelled, 0); atomic_init(&job->done, 0);
  job->url = copyBytes(url, urlSize); job->body = copyBytes(body, bodySize);
  job->headers = copyBytes(headers, headersSize);
  if (certificate) job->certificate = copyBytes(certificate, certificateSize);
  job->certificateSize = storedCertificateSize;
  job->keepAlive = keepAlive;
  job->bodySize = bodySize; job->headersSize = headersSize; job->timeout = timeout;
  if (!job->url || !job->body || !job->headers || (certificate && !job->certificate)) {
    releaseJob(job); xsUnknownError("Live HTTPS allocation failed");
  }
  int expected = 0;
  if (!atomic_compare_exchange_strong(&occupied, &expected, 1)) { releaseJob(job); xsmcSetBoolean(xsResult, 0); return; }
  }
  request->job = job;
  atomic_fetch_add(&job->references, 1);
  // Keep TLS's hot stack off the shared external-memory cache. This task shares
  // priority 4 with application Workers; UI and native audio can preempt it.
  TaskHandle_t task;
  if (xTaskCreateWithCaps(requestTask, "live_https", 8192, job, 4, &task, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) != pdPASS) {
    request->job = NULL; atomic_store(&occupied, 0); releaseJob(job); releaseJob(job);
    xsUnknownError("Live HTTPS task allocation failed");
  }
  xsmcSetBoolean(xsResult, 1);
}
void xs_realtime_http_read(xsMachine *the) {
  HttpRequest *request = xsmcGetHostData(xsThis);
  HttpJob *job = request ? request->job : NULL;
  if (!job || !atomic_load(&job->done)) return;
  xsmcVars(1); xsmcSetNewObject(xsResult);
  xsmcSetInteger(xsVar(0), job->status); xsmcSet(xsResult, xsID("status"), xsVar(0));
  xsmcSetInteger(xsVar(0), job->error); xsmcSet(xsResult, xsID("errorCode"), xsVar(0));
  xsmcSetInteger(xsVar(0), job->transportError); xsmcSet(xsResult, xsID("transportError"), xsVar(0));
  if (!job->error) {
    xsmcSetArrayBuffer(xsVar(0), job->response, job->size);
    xsmcSet(xsResult, xsID("body"), xsVar(0));
  }
  request->job = NULL;
  if (job->client) request->idle = job;
  else releaseJob(job);
}
void xs_realtime_http_close(xsMachine *the) {
  HttpRequest *request = xsmcGetHostData(xsThis);
  xsmcSetHostData(xsThis, NULL);
  xs_realtime_http_destructor(request);
}
