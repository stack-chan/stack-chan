#include "../noise_api.h"
#include "../chat-routes.h"
#include <new>
#include <cstdio>
#include <cstring>
#include <psa/crypto.h>
#include <xplat/noise/core/ClientSession.h>
#include <xplat/noise/core/PsaCryptoBackend.h>
using namespace musegadgets::noise::core;
struct MuseNoise {
  PsaCryptoBackend backend;
  ClientSession session{backend};
  uint8_t wire[MUSE_FRAME_MAX];
  uint8_t service[MUSE_BODY_MAX + 256];
  uint8_t envelope[MUSE_BODY_MAX + 512];
  uint8_t transport[MUSE_FRAME_MAX];
  // Service bodies may span ordered frames; match the SDK session reassembly budget.
  uint8_t response[MUSE_SERVICE_MAX];
  HeaderView headers[16];
};
extern "C" {
MuseNoise *muse_noise_new(void) {
  if (PSA_SUCCESS != psa_crypto_init()) return nullptr;
  return new (std::nothrow) MuseNoise;
}
void muse_noise_delete(MuseNoise *s) { delete s; }
size_t muse_noise_size(void) { return sizeof(MuseNoise); }
int muse_noise_start(MuseNoise *s, const uint8_t **out) {
  auto r = s->session.WriteHandshakeMessage1(ByteSpan(s->wire));
  *out = s->wire;
  return r.ok() ? static_cast<int>(r.size()) : -1;
}
int muse_noise_handshake(MuseNoise *s, const uint8_t *data, size_t size, const uint8_t **out) {
  size_t extra = 0;
  if (!s->session.ReadHandshakeMessage2(ConstByteSpan(data, size), ByteSpan(s->transport), extra).ok()) return -1;
  auto r = s->session.WriteHandshakeMessage3(ConstByteSpan(), ByteSpan(s->wire));
  *out = s->wire;
  return r.ok() ? static_cast<int>(r.size()) : -1;
}
int muse_noise_request(MuseNoise *s, int stream, int route, const uint8_t *body, size_t size) {
  if (size > MUSE_BODY_MAX || !muse_chat_route_valid(stream, route)) return -1;
  HeaderView h[] = {{StringView("Content-Type"), StringView("application/json")},
    {StringView("Accept"), StringView("application/x-ndjson")}};
  ApplicationRequestView request{StringView("POST"),
    StringView(route == 0 ? "/link-control" : route == 2 ? "/chat/subscribe" : "/chat/stream"),
    Span<const HeaderView>(h, route == 2 ? 2 : 1), ConstByteSpan(body, size), route == 1 || route == 2};
  return s->session.StartOutboundApplicationRequest(ServiceType::Daemon, stream, request,
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_chunk(MuseNoise *s, const uint8_t *body, size_t size) {
  if (size > MUSE_BODY_MAX) return -1;
  return s->session.StartOutboundBodyChunk(ServiceType::Daemon, 1,
    BodyChunkView{ConstByteSpan(body, size), false}, ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
static bool voice_stream(int stream) { return stream > 0 && (stream & 1); }
int muse_noise_tts_request(MuseNoise *s, int stream, const char *message_id, int legacy) {
  char path[432];
  if (stream < 5 || !(stream & 1) || muse_tts_path(path, sizeof(path), message_id, legacy)) return -1;
  HeaderView headers[] = {{StringView("Accept"), StringView("audio/mpeg")}};
  ApplicationRequestView request{StringView("GET"), StringView(path), Span<const HeaderView>(headers, 1),
    ConstByteSpan(), true};
  return s->session.StartOutboundApplicationRequest(ServiceType::Daemon, stream, request,
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_voice_request(MuseNoise *s, int stream, const char *call_id, const uint8_t *body, size_t size) {
  if (!voice_stream(stream) || size > MUSE_BODY_MAX || !call_id || strlen(call_id) != 36 ||
      strspn(call_id, "0123456789abcdefABCDEF-") != 36) return -1;
  char path[80];
  snprintf(path, sizeof(path), "/voice/realtime?call_id=%s", call_id);
  HeaderView headers[] = {{StringView("Content-Type"), StringView("application/x-ndjson")},
    {StringView("Accept"), StringView("application/x-ndjson")}};
  ApplicationRequestView request{StringView("POST"), StringView(path), Span<const HeaderView>(headers, 2),
    ConstByteSpan(body, size), false};
  return s->session.StartOutboundApplicationRequest(ServiceType::Daemon, stream, request,
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_end_call(MuseNoise *s, int stream, const uint8_t *body, size_t size) {
  if (!voice_stream(stream) || size > MUSE_BODY_MAX) return -1;
  HeaderView headers[] = {{StringView("Content-Type"), StringView("application/json")}};
  ApplicationRequestView request{StringView("POST"), StringView("/voice/end-call"), Span<const HeaderView>(headers, 1),
    ConstByteSpan(body, size), true};
  return s->session.StartOutboundApplicationRequest(ServiceType::Daemon, stream, request,
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_body_chunk(MuseNoise *s, int stream, const uint8_t *body, size_t size, int end) {
  if (!voice_stream(stream) || size > MUSE_BODY_MAX) return -1;
  return s->session.StartOutboundBodyChunk(ServiceType::Daemon, stream,
    BodyChunkView{ConstByteSpan(body, size), end != 0}, ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_reset(MuseNoise *s, int stream) {
  if (!voice_stream(stream)) return -1;
  return s->session.StartOutboundReset(ServiceType::Daemon, stream, ResetView{},
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_next(MuseNoise *s, const uint8_t **out) {
  if (!s->session.HasOutboundWebSocketPayload()) return 0;
  auto r = s->session.WriteNextOutboundWebSocketPayload(ByteSpan(s->wire));
  *out = s->wire;
  return r.ok() ? static_cast<int>(r.size()) : -1;
}
int muse_noise_receive(MuseNoise *s, const uint8_t *data, size_t size, MuseFrame *frame) {
  if (size > MUSE_FRAME_MAX) return -1;
  auto r = s->session.ProcessInboundWebSocketPayload(ConstByteSpan(data, size), ByteSpan(s->transport),
    ByteSpan(s->response), Span<HeaderView>(s->headers, 16));
  if (!r.ok()) return -1;
  if (r.frame_status != InboundFrameStatus::Complete) return 0;
  if (r.frame.stream_id < 1 || r.frame.stream_id > 0x7fffffff) return -1;
  auto &f = r.frame;
  *frame = {static_cast<int>(f.stream_id), static_cast<int>(f.kind), f.response.status, 0, nullptr, 0};
  if (f.kind == ServiceFrameKind::Response) {
    frame->body = f.response.body.data(); frame->size = f.response.body.size(); frame->end = f.response.end_body;
  } else if (f.kind == ServiceFrameKind::BodyChunk) {
    frame->body = f.body_chunk.data.data(); frame->size = f.body_chunk.data.size(); frame->end = f.body_chunk.end_body;
  }
  return 1;
}
}
