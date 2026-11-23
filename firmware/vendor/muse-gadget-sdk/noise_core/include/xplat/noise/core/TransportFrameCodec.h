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

#include <xplat/noise/core/CryptoBackend.h>
#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>

namespace musegadgets::noise::core {

struct TransportFrameView {
  uint64_t chunk_id{0};
  uint32_t chunk_index{0};
  uint32_t total_chunks{0};
  ConstByteSpan payload;
};

struct DecodedTransportFrame {
  uint64_t chunk_id{0};
  uint32_t chunk_index{0};
  uint32_t total_chunks{0};
  ConstByteSpan payload;
};

enum class TransportFrameDecodeError : uint8_t {
  None,
  MalformedVarint,
  InvalidFieldKey,
  WrongWireType,
  DuplicateScalarField,
  PayloadLengthOutOfRange,
  MissingTotalChunks,
  InvalidTotalChunks,
  ChunkIndexOutOfRange,
};

struct TransportFrameDecodeResult {
  Status status{OkStatus()};
  TransportFrameDecodeError error{TransportFrameDecodeError::None};

  [[nodiscard]] constexpr bool ok() const noexcept {
    return status.ok();
  }
};

[[nodiscard]] size_t EncodedTransportFrameSize(
    TransportFrameView frame) noexcept;

[[nodiscard]] StatusWithSize EncodeTransportFrame(
    TransportFrameView frame,
    ByteSpan out) noexcept;

[[nodiscard]] TransportFrameDecodeResult DecodeTransportFrameDetailed(
    ConstByteSpan bytes,
    DecodedTransportFrame& out) noexcept;

[[nodiscard]] Status DecodeTransportFrame(
    ConstByteSpan bytes,
    DecodedTransportFrame& out) noexcept;

enum class InboundFrameStatus : uint8_t {
  NeedMore,
  Complete,
  Violation,
};

struct InboundFrameResult {
  InboundFrameStatus frame_status{InboundFrameStatus::NeedMore};
  Status status{OkStatus()};
  size_t size{0};
};

class OrderedTransportFramer {
 public:
  static constexpr size_t kAeadTagSize = 16;
  static constexpr size_t kProtoOverhead = 30;
  static constexpr size_t kMaxChunkPayload =
      65535 - kAeadTagSize - kProtoOverhead;
  static constexpr size_t kMaxEncodedFrameSize = 65535 - kAeadTagSize;
  static constexpr size_t kMaxReassembledLen = 16u * 1024u * 1024u;
  static constexpr uint32_t kMaxTotalChunks =
      static_cast<uint32_t>(kMaxReassembledLen / kMaxChunkPayload + 1);

  explicit constexpr OrderedTransportFramer(
      CryptoBackend* backend = nullptr) noexcept
      : backend_(backend) {}

  [[nodiscard]] Status StartOutboundMessage(ConstByteSpan message) noexcept;

  [[nodiscard]] constexpr bool HasOutboundMessage() const noexcept {
    return outboundActive_;
  }

  [[nodiscard]] StatusWithSize EncodeNextOutboundFrame(ByteSpan out) noexcept;

  // Where an in-place encode put its frame within the caller's buffer.
  struct InPlaceFrame {
    Status status{OkStatus()};
    size_t offset{0};
    size_t size{0};
  };

  // Encodes a whole outbound message that fits one transport frame around
  // the message where it already sits (`buffer[messageOffset, +messageSize)`):
  // the frame's fields go in the bytes just before it, so nothing is copied.
  // The result is byte for byte what StartOutboundMessage and one
  // EncodeNextOutboundFrame produce. Fails without changing state if another
  // outbound message is in progress, the message does not fit one frame, or
  // there is no room for the fields in front of it.
  [[nodiscard]] InPlaceFrame EncodeSingleFrameInPlace(
      ByteSpan buffer,
      size_t messageOffset,
      size_t messageSize) noexcept;

  [[nodiscard]] InboundFrameResult DecodeAndAppendInboundFrame(
      ConstByteSpan frameBytes,
      ByteSpan messageOut) noexcept;

  // As DecodeAndAppendInboundFrame, and on Complete `message` views the whole
  // message. A message that arrives in one frame is not copied: `message`
  // points into `frameBytes`. Otherwise it is reassembled in `messageOut` and
  // `message` points there.
  [[nodiscard]] InboundFrameResult DecodeInboundFrame(
      ConstByteSpan frameBytes,
      ByteSpan messageOut,
      ConstByteSpan& message) noexcept;

  struct InboundStateSnapshot {
    uint64_t chunk_id{0};
    uint32_t total_chunks{0};
    uint32_t next_index{0};
    size_t bytes{0};
    bool active{false};
    bool poisoned{false};
  };

  [[nodiscard]] InboundStateSnapshot SnapshotInboundState() const noexcept;

  void RestoreInboundState(InboundStateSnapshot snapshot) noexcept;

  void ResetInbound() noexcept;

  [[nodiscard]] constexpr bool isInboundPoisoned() const noexcept {
    return inboundPoisoned_;
  }

#if defined(NOISE_BUILDING_TESTS)
  void setNextChunkIdForTesting(uint64_t chunkId) noexcept {
    nextChunkIdOverride_ = chunkId;
    hasNextChunkIdOverride_ = true;
  }
#endif // NOISE_BUILDING_TESTS

 private:
  [[nodiscard]] Status GenerateChunkId(uint64_t& chunkId) noexcept;
  [[nodiscard]] InboundFrameResult PoisonInbound(Status status) noexcept;
  [[nodiscard]] InboundFrameResult DecodeInbound(
      ConstByteSpan frameBytes,
      ByteSpan messageOut,
      ConstByteSpan* view) noexcept;

  CryptoBackend* backend_{nullptr};

  ConstByteSpan outboundMessage_;
  uint64_t outboundChunkId_{0};
  uint32_t outboundTotalChunks_{0};
  uint32_t outboundNextIndex_{0};
  bool outboundActive_{false};

  uint64_t nextChunkIdOverride_{0};
  bool hasNextChunkIdOverride_{false};

  uint64_t inboundChunkId_{0};
  uint32_t inboundTotalChunks_{0};
  uint32_t inboundNextIndex_{0};
  size_t inboundBytes_{0};
  bool inboundActive_{false};
  bool inboundPoisoned_{false};
};

} // namespace musegadgets::noise::core
