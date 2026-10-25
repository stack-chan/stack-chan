#include "../noise_api.h"
#include <new>
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
  uint8_t response[MUSE_FRAME_MAX];
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
  // Owner WsBearer route: credentials belong to the TLS upgrade header.
  auto r = s->session.WriteHandshakeMessage3(ConstByteSpan(), ByteSpan(s->wire));
  *out = s->wire;
  return r.ok() ? static_cast<int>(r.size()) : -1;
}
int muse_noise_request(MuseNoise *s, int stream, int route, const uint8_t *body, size_t size) {
  if (size > MUSE_BODY_MAX || route < 0 || route > 2 ||
      (route == 0 ? stream != 1 : route == 2 ? stream != 3 : (stream < 5 || !(stream & 1)))) return -1;
  HeaderView h[] = {{StringView("Content-Type"), StringView("application/json")},
    {StringView("Accept"), StringView("application/x-ndjson")}};
  ApplicationRequestView request{StringView("POST"),
    StringView(route == 0 ? "/link-control" : route == 1 ? "/chat/stream" : "/chat/subscribe"),
    Span<const HeaderView>(h, route == 2 ? 2 : 1), ConstByteSpan(body, size), route != 0};
  return s->session.StartOutboundApplicationRequest(ServiceType::Daemon, stream, request,
    ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
}
int muse_noise_chunk(MuseNoise *s, const uint8_t *body, size_t size) {
  if (size > MUSE_BODY_MAX) return -1;
  return s->session.StartOutboundBodyChunk(ServiceType::Daemon, 1,
    BodyChunkView{ConstByteSpan(body, size), false}, ByteSpan(s->service), ByteSpan(s->envelope)).ok() ? 0 : -1;
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
