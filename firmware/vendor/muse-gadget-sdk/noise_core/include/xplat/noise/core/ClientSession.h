/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>

#include <xplat/noise/core/CryptoBackend.h>
#include <xplat/noise/core/InitiatorHandshake.h>
#include <xplat/noise/core/ServiceCodec.h>
#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>
#include <xplat/noise/core/Transport.h>
#include <xplat/noise/core/TransportFrameCodec.h>

namespace musegadgets::noise::core {

// Result for one inbound encrypted websocket payload.
//
// When `frame_status == InboundFrameStatus::Complete`, `frame` contains views
// into the caller-provided `transportFrameScratch` (a message that arrived in
// one transport frame) or `serviceResponseScratch` (one reassembled from
// several) passed to `ProcessInboundWebSocketPayload`. Header views use the
// caller-provided `headerStorage`. These buffers must outlive use of `frame`.
struct ClientSessionInboundResult {
  InboundFrameStatus frame_status{InboundFrameStatus::NeedMore};
  Status status{OkStatus()};
  ServiceCodecError service_error{ServiceCodecError::None};
  size_t size{0};
  size_t required_headers{0};
  DecodedServiceFrame frame;

  [[nodiscard]] constexpr bool ok() const noexcept {
    return status.ok();
  }
};

// No-exception embedded Noise client session facade for binary websocket
// payload callers. It owns no sockets and depends only on the embedded core
// handshake, transport, ordered transport framer, and service codec.
//
// Callers serialize access. Outbound `StartOutbound*` methods encode a service
// request envelope into caller-owned scratch and store a view into that
// envelope in the ordered framer. `requestEnvelopeScratch` must remain live and
// byte-stable until `HasOutboundWebSocketPayload()` becomes false. The request
// views and `serviceFrameScratch` may be reused after `StartOutbound*` returns.
class ClientSession {
 public:
  static constexpr size_t kMaxOutboundWebSocketPayloadSize =
      OrderedTransportFramer::kMaxEncodedFrameSize + Transport::kTagSize;

  explicit ClientSession(CryptoBackend& backend) noexcept;
  ~ClientSession() noexcept;

  ClientSession(const ClientSession&) = delete;
  ClientSession& operator=(const ClientSession&) = delete;
  ClientSession(ClientSession&&) = delete;
  ClientSession& operator=(ClientSession&&) = delete;

  [[nodiscard]] bool isEstablished() const noexcept;

  [[nodiscard]] bool HasOutboundWebSocketPayload() const noexcept;

  [[nodiscard]] StatusWithSize WriteHandshakeMessage1(
      ByteSpan websocketPayloadOut) noexcept;

  [[nodiscard]] Status ReadHandshakeMessage2(
      ConstByteSpan websocketPayload,
      ByteSpan peerExtraScratchOut,
      size_t& peerExtraWritten) noexcept;

  [[nodiscard]] StatusWithSize WriteHandshakeMessage3(
      ConstByteSpan authPayload,
      ByteSpan websocketPayloadOut) noexcept;

  [[nodiscard]] StatusWithSize StartOutboundApplicationRequest(
      ServiceType service,
      int64_t streamId,
      ApplicationRequestView request,
      ByteSpan serviceFrameScratch,
      ByteSpan requestEnvelopeScratch) noexcept;

  [[nodiscard]] StatusWithSize StartOutboundBodyChunk(
      ServiceType service,
      int64_t streamId,
      BodyChunkView chunk,
      ByteSpan serviceFrameScratch,
      ByteSpan requestEnvelopeScratch) noexcept;

  [[nodiscard]] StatusWithSize StartOutboundReset(
      ServiceType service,
      int64_t streamId,
      ResetView reset,
      ByteSpan serviceFrameScratch,
      ByteSpan requestEnvelopeScratch) noexcept;

  // Uses `websocketPayloadScratchAndOut` first as plaintext transport-frame
  // scratch, then overwrites it in place with the encrypted websocket payload.
  // To avoid consuming the ordered-framer state before output capacity is
  // known, the buffer must be at least `kMaxOutboundWebSocketPayloadSize`.
  [[nodiscard]] StatusWithSize WriteNextOutboundWebSocketPayload(
      ByteSpan websocketPayloadScratchAndOut) noexcept;

  // Where SealBodyChunkInPlace put the encrypted websocket payload.
  struct InPlacePayload {
    Status status{OkStatus()};
    size_t offset{0};
    size_t size{0};
  };

  // Encodes and encrypts one BodyChunk (end_body false) around data that
  // already sits at `buffer[dataOffset, +dataSize)`, with no copy of it: the
  // frame headers go in the bytes before it and the tag after it. On success
  // the websocket payload is `buffer[offset, +size)`, the same bytes that
  // StartOutboundBodyChunk and WriteNextOutboundWebSocketPayload produce.
  // Needs no outbound message in progress, a chunk that fits one transport
  // frame, up to kMaxBodyChunkInPlaceHeadroom bytes before the data and
  // Transport::kTagSize after it. Fails without changing state if not; a
  // failed seal fails the session.
  static constexpr size_t kMaxBodyChunkInPlaceHeadroom = 64;
  [[nodiscard]] InPlacePayload SealBodyChunkInPlace(
      ServiceType service,
      int64_t streamId,
      ByteSpan buffer,
      size_t dataOffset,
      size_t dataSize) noexcept;

  // A message that arrives in one transport frame is decoded where it was
  // decrypted, in `transportFrameScratch`; only messages split across frames
  // are reassembled in `serviceResponseScratch`. The decoded frame's views
  // point into whichever holds the message.
  [[nodiscard]] ClientSessionInboundResult ProcessInboundWebSocketPayload(
      ConstByteSpan websocketPayload,
      ByteSpan transportFrameScratch,
      ByteSpan serviceResponseScratch,
      Span<HeaderView> headerStorage) noexcept;

#if defined(NOISE_BUILDING_TESTS)
  [[nodiscard]] Status SetStaticKeypairForTesting(
      ConstByteSpan privateKey32,
      ConstByteSpan publicKey32) noexcept {
    return handshake_.SetStaticKeypairForTesting(privateKey32, publicKey32);
  }

  [[nodiscard]] Status SetEphemeralKeypairForTesting(
      ConstByteSpan privateKey32,
      ConstByteSpan publicKey32) noexcept {
    return handshake_.SetEphemeralKeypairForTesting(privateKey32, publicKey32);
  }

  void setNextOutboundChunkIdForTesting(uint64_t chunkId) noexcept {
    framer_.setNextChunkIdForTesting(chunkId);
  }
#endif // NOISE_BUILDING_TESTS

 private:
  enum class Stage : uint8_t {
    Init,
    WroteMessage1,
    ReadMessage2,
    Established,
    Failed,
  };

  [[nodiscard]] StatusWithSize StartOutboundServiceFrame(
      ServiceType service,
      ServiceFrameView frame,
      ByteSpan serviceFrameScratch,
      ByteSpan requestEnvelopeScratch) noexcept;

  CryptoBackend& backend_;
  InitiatorHandshake handshake_;
  OrderedTransportFramer framer_;
  std::optional<Transport> transport_;
  Stage stage_{Stage::Init};
};

} // namespace musegadgets::noise::core
