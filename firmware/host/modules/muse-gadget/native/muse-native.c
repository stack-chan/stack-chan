#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include "noise_api.h"
#include "receive.h"
#include "lifetime.h"
#include "esp_websocket_client.h"
#include "esp_crt_bundle.h"
#include <stdlib.h>
#include <string.h>

/* Only websocket callbacks touch rx/frameOffset. Only XS touches Noise.
 * stop/destroy joins the websocket task before the owner's reference is freed.
 * Each posted event owns another reference, following local-peer-radio.c.
 */
typedef struct {
  xsMachine *the;
  xsSlot object;
  esp_websocket_client_handle_t ws;
  MuseNoise *noise;
  MuseLifetime life;
  MuseReceive rx;
  char uri[512];
  char authorization[2080];
} MuseRecord;

static void release(MuseRecord *r) {
  if (muse_event_release(&r->life)) free(r);
}
static void deliver(void *the, void *refcon, uint8_t *message, uint16_t size) {
  MuseRecord *r = refcon;
  if (muse_event_begin(&r->life)) {
    xsBeginHost(the);
      xsTry {
        xsmcVars(1);
        xsmcSetArrayBuffer(xsVar(0), message + 1, size - 1);
        xsCall2(r->object, xsID("onEvent"), xsInteger(__atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST) ? 3 : message[0]), xsVar(0));
      }
      xsCatch { /* User callback cannot leak an event reference. */ }
    xsEndHost(the);
  }
  release(r);
}
static void post(MuseRecord *r, uint8_t type, size_t size) {
  if (!muse_event_hold(&r->life)) return;
  r->rx.payload[0] = type;
  // modMessagePostToMachine copies bytes, never retains the SDK event buffer.
  if (modMessagePostToMachine(r->the, r->rx.payload, size + 1, deliver, r)) {
    __atomic_store_n(&r->life.failed, 1, __ATOMIC_SEQ_CST);
    __atomic_sub_fetch(&r->life.pending, 1, __ATOMIC_SEQ_CST);
    release(r);
  }
}
static void event(void *refcon, esp_event_base_t base, int32_t id, void *payload) {
  MuseRecord *r = refcon;
  esp_websocket_event_data_t *e = payload;
  (void)base;
  if (__atomic_load_n(&r->life.closed, __ATOMIC_SEQ_CST)) return;
  if (id == WEBSOCKET_EVENT_CONNECTED) { post(r, 1, 0); return; }
  if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_ERROR) { post(r, 3, 0); return; }
  if (id != WEBSOCKET_EVENT_DATA) return;
  if (__atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST)) return;
  int result = muse_receive_append(&r->rx, e->op_code, e->fin, e->payload_len, e->payload_offset, e->data_ptr, e->data_len);
  if (result < 0) goto invalid;
  if (result > 0) { post(r, 2, r->rx.size); r->rx.size = 0; }
  return;
invalid:
  __atomic_store_n(&r->life.failed, 1, __ATOMIC_SEQ_CST);
  post(r, 3, 0);
}
static void museShutdown(MuseRecord *r) {
  if (!r || !muse_owner_close(&r->life)) return;
  if (r->ws) {
    esp_websocket_client_stop(r->ws);
    esp_websocket_unregister_events(r->ws, WEBSOCKET_EVENT_ANY, event);
    esp_websocket_client_destroy(r->ws);
    r->ws = NULL;
  }
  muse_noise_delete(r->noise);
  r->noise = NULL;
  volatile char *secret = r->authorization;
  for (size_t i = 0; i < sizeof(r->authorization); i++) secret[i] = 0;
  release(r);
}
void xs_muse_destructor(void *data) { museShutdown(data); }
static MuseRecord *get(xsMachine *the) {
  MuseRecord *r = xsmcGetHostDataValidate(xsThis, xs_muse_destructor);
  if (!r || __atomic_load_n(&r->life.closed, __ATOMIC_SEQ_CST) ||
      __atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST)) xsUnknownError("Muse connection unavailable");
  return r;
}
void xs_muse_constructor(xsMachine *the) {
  char host[254], vm[129], token[2049];
  xsmcToStringBuffer(xsArg(0), host, sizeof(host));
  xsmcToStringBuffer(xsArg(1), vm, sizeof(vm));
  xsmcToStringBuffer(xsArg(2), token, sizeof(token));
  if (!host[0] || !vm[0] || !token[0] || strspn(host, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-") != strlen(host) ||
      strspn(vm, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != strlen(vm) ||
      strchr(token, '\r') || strchr(token, '\n')) xsRangeError("invalid Muse configuration");
  MuseRecord *r = calloc(1, sizeof(MuseRecord));
  if (!r) xsUnknownError("Muse allocation failed");
  r->the = the; r->object = xsThis; r->life.references = 1;
  snprintf(r->uri, sizeof(r->uri), "wss://%s/v1/noise?vm_id=%s", host, vm);
  snprintf(r->authorization, sizeof(r->authorization), "Authorization: Bearer %s\r\n", token);
  volatile char *p = token;
  for (size_t i = 0; i < sizeof(token); i++) p[i] = 0;
  r->noise = muse_noise_new();
  esp_websocket_client_config_t config = {0};
  config.uri = r->uri;
  config.headers = r->authorization;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.disable_auto_reconnect = true;
  config.network_timeout_ms = 5000;
  config.buffer_size = 2048;
  config.task_stack = 6144;
  if (r->noise) r->ws = esp_websocket_client_init(&config);
  if (!r->ws || ESP_OK != esp_websocket_register_events(r->ws, WEBSOCKET_EVENT_ANY, event, r)) {
    museShutdown(r);
    xsUnknownError("Muse initialization failed");
  }
  xsmcSetHostData(xsThis, r);
  xsRemember(r->object);
  if (ESP_OK != esp_websocket_client_start(r->ws)) {
    xsmcSetHostData(xsThis, NULL);
    xsForget(r->object);
    museShutdown(r);
    xsUnknownError("Muse transport start failed");
  }
}
void xs_muse_close(xsMachine *the) {
  MuseRecord *r = xsmcGetHostData(xsThis);
  if (!r) return;
  xsmcSetHostData(xsThis, NULL);
  xsForget(r->object);
  museShutdown(r);
}
static void museSend(xsMachine *the, MuseRecord *r, const uint8_t *data, int size) {
  if (size < 0 || esp_websocket_client_send_bin(r->ws, (const char *)data, size, pdMS_TO_TICKS(1000)) != size)
    xsUnknownError("Muse send failed");
}
static void flush(xsMachine *the, MuseRecord *r) {
  const uint8_t *data;
  int size;
  while ((size = muse_noise_next(r->noise, &data)) > 0) museSend(the, r, data, size);
  if (size < 0) xsUnknownError("Muse encode failed");
}
void xs_muse_start(xsMachine *the) {
  MuseRecord *r = get(the); const uint8_t *data;
  int size = muse_noise_start(r->noise, &data);
  museSend(the, r, data, size);
}
void xs_muse_handshake(xsMachine *the) {
  MuseRecord *r = get(the); const uint8_t *out = NULL; void *data; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(0), &data, &size);
  int length = muse_noise_handshake(r->noise, data, size, &out);
  museSend(the, r, out, length);
}
void xs_muse_request(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(2), &data, &size);
  if (muse_noise_request(r->noise, xsmcToInteger(xsArg(0)), xsmcToInteger(xsArg(1)), data, size)) xsUnknownError("Muse request failed");
  flush(the, r);
}
void xs_muse_chunk(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(0), &data, &size);
  if (muse_noise_chunk(r->noise, data, size)) xsUnknownError("Muse chunk failed");
  flush(the, r);
}
void xs_muse_receive(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size; MuseFrame frame;
  xsmcGetBufferReadable(xsArg(0), &data, &size);
  int result = muse_noise_receive(r->noise, data, size, &frame);
  if (result < 0) xsUnknownError("Muse decode failed");
  if (!result) return;
  xsmcVars(1);
  xsmcSetNewObject(xsResult);
  xsmcSetInteger(xsVar(0), frame.stream); xsmcSet(xsResult, xsID("stream"), xsVar(0));
  xsmcSetInteger(xsVar(0), frame.kind); xsmcSet(xsResult, xsID("kind"), xsVar(0));
  xsmcSetInteger(xsVar(0), frame.status); xsmcSet(xsResult, xsID("status"), xsVar(0));
  xsmcSetBoolean(xsVar(0), frame.end); xsmcSet(xsResult, xsID("end"), xsVar(0));
  xsmcSetArrayBuffer(xsVar(0), (void *)frame.body, frame.size); xsmcSet(xsResult, xsID("body"), xsVar(0));
}
