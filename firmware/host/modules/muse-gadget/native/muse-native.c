#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include "noise_api.h"
#include "muse-transport.h"
#include "receive.h"
#include "lifetime.h"
#include "esp_websocket_client.h"
#include "esp_crt_bundle.h"
#include "mbedtls/x509.h"
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
  uint8_t failure_reason;
  MuseReceive rx;
  char uri[512];
  char authorization[2080];
} MuseRecord;

static void release(MuseRecord *r) {
  if (muse_event_release(&r->life)) free(r);
}
static void deliver(uint8_t type, void *the, void *refcon, uint8_t *message, uint16_t size) {
  MuseRecord *r = refcon;
  if (muse_event_begin(&r->life)) {
    xsBeginHost(the);
      xsTry {
        xsmcVars(1);
        if (__atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST)) {
          uint8_t reason = __atomic_load_n(&r->failure_reason, __ATOMIC_SEQ_CST);
          xsmcSetArrayBuffer(xsVar(0), &reason, 1);
        } else xsmcSetArrayBuffer(xsVar(0), message, size);
        xsCall2(r->object, xsID("onEvent"), xsInteger(__atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST) ? 3 : type), xsVar(0));
      }
      xsCatch { /* User callback cannot leak an event reference. */ }
    xsEndHost(the);
  }
  release(r);
}
static void deliver_connected(void *the, void *refcon, uint8_t *message, uint16_t size) {
  deliver(1, the, refcon, message, size);
}
static void deliver_data(void *the, void *refcon, uint8_t *message, uint16_t size) {
  deliver(2, the, refcon, message, size);
}
static void deliver_failed(void *the, void *refcon, uint8_t *message, uint16_t size) {
  deliver(3, the, refcon, message, size);
}
static void post(MuseRecord *r, uint8_t type, size_t size) {
  if (size > MUSE_FRAME_MAX || size > UINT16_MAX) {
    __atomic_store_n(&r->failure_reason, 23, __ATOMIC_SEQ_CST);
    __atomic_store_n(&r->life.failed, 1, __ATOMIC_SEQ_CST);
    type = 3;
    size = 0;
  }
  if (!muse_event_hold(&r->life)) { __atomic_store_n(&r->failure_reason, 20, __ATOMIC_SEQ_CST); return; }
  // modMessagePostToMachine copies bytes, never retains the SDK event buffer.
  if (modMessagePostToMachine(r->the, r->rx.payload, (uint16_t)size, type == 1 ? deliver_connected : type == 2 ? deliver_data : deliver_failed, r)) {
    __atomic_store_n(&r->failure_reason, 21, __ATOMIC_SEQ_CST);
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
  if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_ERROR) {
    if (id == WEBSOCKET_EVENT_ERROR && (!e || e->error_handle.error_type == WEBSOCKET_ERROR_TYPE_NONE)) return;
    uint8_t reason = 0;
    if (e) {
      esp_websocket_error_codes_t *error = &e->error_handle;
      if (error->error_type != WEBSOCKET_ERROR_TYPE_TCP_TRANSPORT) {
        if (error->error_type == WEBSOCKET_ERROR_TYPE_HANDSHAKE) reason = 6;
        else if (error->error_type == WEBSOCKET_ERROR_TYPE_PONG_TIMEOUT) reason = 8;
      }
      else if (error->esp_tls_cert_verify_flags & MBEDTLS_X509_BADCERT_EXPIRED) reason = 9;
      else if (error->esp_tls_cert_verify_flags & MBEDTLS_X509_BADCERT_FUTURE) reason = 10;
      else if (error->esp_tls_cert_verify_flags & MBEDTLS_X509_BADCERT_CN_MISMATCH) reason = 11;
      else if (error->esp_tls_cert_verify_flags & MBEDTLS_X509_BADCERT_NOT_TRUSTED) reason = 12;
      else if (error->esp_tls_cert_verify_flags) reason = 1;
      else if (error->esp_tls_stack_err) reason = 2;
      else if (error->esp_ws_handshake_status_code == 401) reason = 3;
      else if (error->esp_ws_handshake_status_code == 403) reason = 4;
      else if (error->esp_ws_handshake_status_code >= 400) reason = 5;
      else if (error->error_type == WEBSOCKET_ERROR_TYPE_HANDSHAKE) reason = 6;
      else if (error->error_type == WEBSOCKET_ERROR_TYPE_TCP_TRANSPORT) reason = 7;
      else if (error->error_type == WEBSOCKET_ERROR_TYPE_PONG_TIMEOUT) reason = 8;
    }
    r->rx.payload[0] = reason;
    post(r, 3, 1); return;
  }
  if (id != WEBSOCKET_EVENT_DATA) return;
  if (__atomic_load_n(&r->life.failed, __ATOMIC_SEQ_CST)) return;
  int result = muse_receive_append(&r->rx, e->op_code, e->fin, e->payload_len, e->payload_offset, e->data_ptr, e->data_len);
  if (result < 0) goto invalid;
  if (result > 0) { post(r, 2, r->rx.size); r->rx.size = 0; }
  return;
invalid:
  __atomic_store_n(&r->failure_reason, e->payload_len > MUSE_FRAME_MAX ? 23 : 22, __ATOMIC_SEQ_CST);
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
void muse_transport_initialize_diagnostic(xsMachine *the, const char *host, const char *vm, const char *token, const char *app,MuseTransportStage *stage) {
  if(stage)*stage=MUSE_TRANSPORT_CONFIGURATION;
  if (!host || !vm || !token || !app || strlen(host) > 253 || strlen(vm) > 128 || strlen(token) > 2048 || strlen(app) > 64)
    xsRangeError("invalid Muse configuration");
  if (strspn(app, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != strlen(app)) xsRangeError("invalid Muse app ID");
  if (!host[0] || !vm[0] || !token[0] || strspn(host, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-") != strlen(host) ||
      strspn(vm, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != strlen(vm) ||
      strchr(token, '\r') || strchr(token, '\n')) xsRangeError("invalid Muse configuration");
  if(stage)*stage=MUSE_TRANSPORT_RECORD;
  MuseRecord *r = calloc(1, sizeof(MuseRecord));
  if (!r) xsUnknownError("Muse allocation failed");
  r->the = the; r->object = xsThis; r->life.references = 1;
  snprintf(r->uri, sizeof(r->uri), "wss://%s/v1/noise?vm_id=%s%s%s", host, vm, app[0] ? "&app_id=" : "", app);
  snprintf(r->authorization, sizeof(r->authorization), "Authorization: Bearer %s\r\n", token);
  if(stage)*stage=MUSE_TRANSPORT_NOISE;
  r->noise = muse_noise_new();
  esp_websocket_client_config_t config = {0};
  config.uri = r->uri;
  config.headers = r->authorization;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.disable_auto_reconnect = true;
  config.network_timeout_ms = 5000;
  config.buffer_size = 2048;
  config.task_stack = 6144;
  if (r->noise) {
    if(stage)*stage=MUSE_TRANSPORT_WEBSOCKET;
    r->ws = esp_websocket_client_init(&config);
  }
  if (!r->ws) {
    museShutdown(r);
    xsUnknownError("Muse initialization failed");
  }
  if(stage)*stage=MUSE_TRANSPORT_EVENTS;
  if (ESP_OK != esp_websocket_register_events(r->ws, WEBSOCKET_EVENT_ANY, event, r)) {
    museShutdown(r);
    xsUnknownError("Muse initialization failed");
  }
  xsmcSetHostData(xsThis, r);
  xsRemember(r->object);
  if(stage)*stage=MUSE_TRANSPORT_START;
  if (ESP_OK != esp_websocket_client_start(r->ws)) {
    xsmcSetHostData(xsThis, NULL);
    xsForget(r->object);
    museShutdown(r);
    xsUnknownError("Muse transport start failed");
  }
  if(stage)*stage=MUSE_TRANSPORT_NONE;
}
void muse_transport_initialize(xsMachine *the,const char *host,const char *vm,const char *token,const char *app) {
  muse_transport_initialize_diagnostic(the,host,vm,token,app,NULL);
}
void xs_muse_constructor(xsMachine *the) {
  char host[254], vm[129], token[2049] = {0}, app[65] = {0};
  xsTry {
    if (xsmcArgc > 3) xsmcToStringBuffer(xsArg(3), app, sizeof(app));
    xsmcToStringBuffer(xsArg(0), host, sizeof(host));
    xsmcToStringBuffer(xsArg(1), vm, sizeof(vm));
    xsmcToStringBuffer(xsArg(2), token, sizeof(token));
    muse_transport_initialize(the, host, vm, token, app);
  }
  xsCatch {
    volatile char *p = token;
    for (size_t i = 0; i < sizeof(token); i++) p[i] = 0;
    xsThrow(xsException);
  }
  volatile char *p = token;
  for (size_t i = 0; i < sizeof(token); i++) p[i] = 0;
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
void xs_muse_tts_request(xsMachine *the) {
  MuseRecord *r = get(the);
  const char *id = xsmcToString(xsArg(1));
  if (muse_noise_tts_request(r->noise, xsmcToInteger(xsArg(0)), id, xsmcToBoolean(xsArg(2)))) xsUnknownError("Muse TTS request failed");
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

void xs_muse_voice_request(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size; char id[40];
  xsmcToStringBuffer(xsArg(1), id, sizeof(id));
  xsmcGetBufferReadable(xsArg(2), &data, &size);
  if (muse_noise_voice_request(r->noise, xsmcToInteger(xsArg(0)), id, data, size)) xsUnknownError("Muse voice request failed");
  flush(the, r);
}
void xs_muse_end_call(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(1), &data, &size);
  if (muse_noise_end_call(r->noise, xsmcToInteger(xsArg(0)), data, size)) xsUnknownError("Muse end-call failed");
  flush(the, r);
}
void xs_muse_body_chunk(xsMachine *the) {
  MuseRecord *r = get(the); void *data; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(1), &data, &size);
  if (muse_noise_body_chunk(r->noise, xsmcToInteger(xsArg(0)), data, size, xsmcToBoolean(xsArg(2)))) xsUnknownError("Muse body chunk failed");
  flush(the, r);
}
void xs_muse_reset_stream(xsMachine *the) {
  MuseRecord *r = get(the);
  if (muse_noise_reset(r->noise, xsmcToInteger(xsArg(0)))) xsUnknownError("Muse stream reset failed");
  flush(the, r);
}
