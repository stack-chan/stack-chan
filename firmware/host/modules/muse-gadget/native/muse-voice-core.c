#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "../../../../vendor/muse-gadget-sdk/voice_core/muse_voice_call_core.c"

typedef struct {
  muse_vc_call_t call;
  muse_vc_turns_t turns;
  muse_vc_reply_gate_t reply;
  muse_vc_uplink_t up;
  muse_vc_resampler_t down;
  char line[MUSE_VC_LINE_MAX + 1];
  char text[MUSE_VC_LINE_MAX + 1];
  uint8_t scratch[24576];
  int16_t pcm[8194];
} VoiceCore;

void xs_muse_vc_destructor(void *data) { free(data); }
static VoiceCore *voiceGet(xsMachine *the) {
  VoiceCore *v = xsmcGetHostData(xsThis);
  if (!v) xsUnknownError("Muse voice core closed");
  return v;
}
static int64_t timeArg(xsMachine *the, xsSlot value) {
  double n = xsmcToNumber(value);
  if (!isfinite(n) || n < 0 || n > 9007199254740991.0) xsRangeError("Invalid Muse time");
  return (int64_t)n;
}
static void number(xsMachine *the, const char *key, int n) {
  xsSlot value = xsInteger(n);
  xsmcSet(xsResult, xsID(key), value);
}
static void span(xsMachine *the, VoiceCore *v, const char *key, muse_vc_span_t s) {
  if (!s.p) return;
  if (!muse_vc_json_unescape(s, v->text, sizeof(v->text))) xsUnknownError("Invalid Muse text");
  xsSlot value = xsString(v->text);
  xsmcSet(xsResult, xsID(key), value);
}
static void snapshot(xsMachine *the, VoiceCore *v, uint32_t actions) {
  xsmcVars(2);
  xsmcSetNewObject(xsResult);
  number(the, "actions", actions);
  number(the, "state", v->call.state);
  number(the, "reason", v->call.reason);
  number(the, "working", muse_vc_call_working(&v->call));
  number(the, "held", v->call.held);
  number(the, "gatePlaying", muse_vc_reply_gate_playing(&v->reply));
  number(the, "gateWaiting", muse_vc_reply_gate_waiting(&v->reply));
  number(the, "gateFull", muse_vc_reply_gate_full(&v->reply));
  number(the, "captionsAllowed", muse_vc_reply_gate_captions(&v->reply));
  number(the, "gateFlush", muse_vc_reply_gate_take_flush(&v->reply));
  xsmcSetNewArray(xsVar(0), v->turns.n_active);
  for (uint8_t i = 0; i < v->turns.n_active; i++) {
    xsmcSetString(xsVar(1), v->turns.active[i].submission);
    xsmcSetIndex(xsVar(0), i, xsVar(1));
  }
  xsmcSet(xsResult, xsID("activeTurns"), xsVar(0));
}
void xs_muse_vc_constructor(xsMachine *the) {
  VoiceCore *v = calloc(1, sizeof(VoiceCore));
  if (!v) xsUnknownError("Muse voice allocation failed");
  muse_vc_limits_t limits = {15000000, 15000000, 120000000, 1800000000, 5000000, 3000000};
  muse_vc_call_init(&v->call, &limits, &v->turns);
  muse_vc_reply_gate_init(&v->reply);
  muse_vc_uplink_init(&v->up);
  muse_vc_resampler_init(&v->down, 24000, 16000);
  xsmcSetHostData(xsThis, v);
}
void xs_muse_vc_close(xsMachine *the) {
  free(xsmcGetHostData(xsThis));
  xsmcSetHostData(xsThis, NULL);
}
void xs_muse_vc_begin(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  const char *id = xsmcToString(xsArg(0));
  if (!*id || strlen(id) >= MUSE_VC_CALL_ID_MAX) xsRangeError("Invalid Muse call id");
  muse_vc_call_begin(&v->call, id, timeArg(the, xsArg(1)));
  muse_vc_reply_gate_init(&v->reply);
  muse_vc_uplink_init(&v->up);
  muse_vc_resampler_init(&v->down, 24000, 16000);
  snapshot(the, v, 0);
}
void xs_muse_vc_head(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  snapshot(the, v, muse_vc_call_head(&v->call, xsmcToInteger(xsArg(0)), timeArg(the, xsArg(1))));
}
void xs_muse_vc_event(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  const char *line = xsmcToString(xsArg(0));
  size_t len = strlen(line);
  if (len > MUSE_VC_LINE_MAX) xsRangeError("Muse event too large");
  memcpy(v->line, line, len + 1);
  muse_vc_event_t ev;
  if (!muse_vc_parse_event(v->line, len, &ev)) xsUnknownError("Invalid Muse event");
  int64_t now = timeArg(the, xsArg(1));
  bool done = muse_vc_reply_gate_done(&v->reply, &ev);
  bool before = v->call.state == MUSE_VC_LIVE;
  uint32_t actions = muse_vc_call_event(&v->call, &ev, now);
  if (before && v->call.state == MUSE_VC_LIVE) muse_vc_reply_gate_event(&v->reply, &ev);
  bool taking_audio = v->call.state == MUSE_VC_LIVE ||
    (v->call.state == MUSE_VC_ENDING && v->call.reason == MUSE_VC_END_STOP && !v->call.half_closed);
  int verdict = MUSE_VC_GATE_DROP;
  if (ev.kind == MUSE_VC_EV_AUDIO && taking_audio) verdict = muse_vc_reply_gate_audio(&v->reply, &ev);
  snapshot(the, v, actions);
  number(the, "kind", ev.kind);
  number(the, "replyDone", done);
  number(the, "gateVerdict", verdict);
  muse_vc_span_t type;
  if (muse_vc_json_get(v->line, len, "type", &type) == MUSE_VC_J_STRING) span(the, v, "type", type);
  span(the, v, "text", ev.text);
  span(the, v, "itemId", ev.item_id);
  span(the, v, "submissionId", ev.submission_id);
  span(the, v, "responseMessageId", ev.response_message_id);
  if (ev.kind == MUSE_VC_EV_AUDIO && verdict != MUSE_VC_GATE_DROP && taking_audio) {
    bool audible;
    if (!ev.audio_rate_ok) xsUnknownError("Unsupported Muse audio rate");
    long n = muse_vc_decode_audio(&v->down, ev.audio, v->scratch, sizeof(v->scratch), v->pcm, &audible);
    if (n < 0) xsUnknownError("Invalid Muse PCM");
    xsmcVars(1);
    xsmcSetArrayBuffer(xsVar(0), v->pcm, n * sizeof(int16_t));
    xsmcSet(xsResult, xsID("pcm"), xsVar(0));
    number(the, "audible", audible);
  }
}
void xs_muse_vc_action(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  const char *method = xsmcToString(xsArg(0));
  int64_t now = timeArg(the, xsArg(1));
  uint32_t a = 0;
  if (!strcmp(method, "poll")) a = muse_vc_call_poll(&v->call, now);
  else if (!strcmp(method, "hangUp")) a = muse_vc_call_hang_up(&v->call, MUSE_VC_END_LOCAL, now);
  else if (!strcmp(method, "mediaEnd")) a = muse_vc_call_media_end(&v->call, xsmcToBoolean(xsArg(2)), 0, now);
  else if (!strcmp(method, "endSent")) muse_vc_call_end_call_sent(&v->call, now);
  else if (!strcmp(method, "endDone")) a = muse_vc_call_end_call_done(&v->call, now);
  else if (!strcmp(method, "lost")) a = muse_vc_call_lost(&v->call, now);
  else if (!strcmp(method, "activity")) muse_vc_call_activity(&v->call, now);
  else if (!strcmp(method, "press")) { muse_vc_reply_gate_press(&v->reply); muse_vc_uplink_discard(&v->up); }
  else if (!strcmp(method, "overflow")) muse_vc_reply_gate_overflow(&v->reply);
  else if (!strcmp(method, "discard")) muse_vc_uplink_discard(&v->up);
  else xsRangeError("Unknown Muse core action");
  snapshot(the, v, a);
}
void xs_muse_vc_admission(xsMachine *the) {
  voiceGet(the);
  char body[MUSE_VC_ADMISSION_MAX];
  if (!muse_vc_admission(xsmcToString(xsArg(0)), xsmcToString(xsArg(1)), xsmcToBoolean(xsArg(2)), body, sizeof(body))) xsRangeError("Muse admission too large");
  xsResult = xsString(body);
}
void xs_muse_vc_end_body(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  char body[MUSE_VC_END_CALL_MAX];
  if (!muse_vc_end_call_body(&v->call, timeArg(the, xsArg(0)), timeArg(the, xsArg(1)), body, sizeof(body))) xsUnknownError("Muse end-call unavailable");
  xsResult = xsString(body);
}
void xs_muse_vc_uplink(xsMachine *the) {
  VoiceCore *v = voiceGet(the);
  void *pcm; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(0), &pcm, &size);
  if ((size & 1) || ((uintptr_t)pcm & 1) || size > 32000) xsRangeError("Invalid Muse microphone buffer");
  char line[MUSE_VC_APPEND_MAX]; size_t len = 0, consumed = 0;
  int64_t now = timeArg(the, xsArg(1));
  if (v->call.state == MUSE_VC_LIVE && !v->call.held && muse_vc_uplink_may_send(&v->up, now, v->call.live_us))
    consumed = muse_vc_uplink_push(&v->up, pcm, size / 2, line, &len);
  xsmcSetNewObject(xsResult);
  number(the, "consumed", consumed * 2);
  if (len) { line[len] = 0; xsSlot value = xsString(line); xsmcSet(xsResult, xsID("line"), value); }
}
