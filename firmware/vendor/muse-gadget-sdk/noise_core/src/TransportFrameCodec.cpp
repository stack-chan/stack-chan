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

#include <xplat/noise/core/TransportFrameCodec.h>

#include <xplat/noise/core/BufferWriter.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace musegadgets::noise::core {
namespace {

constexpr uint32_t kChunkIdField = 1;
constexpr uint32_t kChunkIndexField = 2;
constexpr uint32_t kTotalChunksField = 3;
constexpr uint32_t kPayloadField = 4;

constexpr uint8_t kWireTypeVarint = 0;
constexpr uint8_t kWireTypeFixed64 = 1;
constexpr uint8_t kWireTypeDelimited = 2;
constexpr uint8_t kWireTypeFixed32 = 5;

constexpr uint32_t kMaxFieldNumber = (1u << 29) - 1;
constexpr uint32_t kFirstReservedFieldNumber = 19000;
constexpr uint32_t kLastReservedFieldNumber = 19999;

struct Cursor {
  ConstByteSpan bytes;
  size_t offset{0};
};

[[nodiscard]] bool IsValidInput(ConstByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

[[nodiscard]] bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

[[nodiscard]] bool ValidFieldNumber(uint64_t fieldNumber) noexcept {
  return fieldNumber != 0 && fieldNumber <= kMaxFieldNumber &&
      !(fieldNumber >= kFirstReservedFieldNumber &&
        fieldNumber <= kLastReservedFieldNumber);
}

[[nodiscard]] bool IsValidWireType(uint8_t wireType) noexcept {
  return wireType == kWireTypeVarint || wireType == kWireTypeFixed64 ||
      wireType == kWireTypeDelimited || wireType == kWireTypeFixed32;
}

[[nodiscard]] TransportFrameDecodeResult DecodeFailure(
    Status status,
    TransportFrameDecodeError error) noexcept {
  return TransportFrameDecodeResult{status, error};
}

[[nodiscard]] size_t VarintSize(uint64_t value) noexcept {
  size_t size = 1;
  while (value >= 0x80) {
    value >>= 7;
    ++size;
  }
  return size;
}

[[nodiscard]] bool AddSize(size_t addend, size_t& total) noexcept {
  if (addend > std::numeric_limits<size_t>::max() - total) {
    return false;
  }
  total += addend;
  return true;
}

[[nodiscard]] bool ComputeEncodedTransportFrameSize(
    TransportFrameView frame,
    size_t& out) noexcept {
  size_t size = 0;
  if (frame.chunk_id != 0 && (!AddSize(1 + VarintSize(frame.chunk_id), size))) {
    return false;
  }
  if (frame.chunk_index != 0 &&
      (!AddSize(1 + VarintSize(frame.chunk_index), size))) {
    return false;
  }
  if (frame.total_chunks != 0 &&
      (!AddSize(1 + VarintSize(frame.total_chunks), size))) {
    return false;
  }
  if (!frame.payload.empty() &&
      (!AddSize(1 + VarintSize(frame.payload.size()), size) ||
       !AddSize(frame.payload.size(), size))) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] Status ValidateOutputAtLeast(
    ByteSpan out,
    size_t required) noexcept {
  if (out.size() < required) {
    return Status::ResourceExhausted();
  }
  if (required != 0 && out.data() == nullptr) {
    return Status::InvalidArgument();
  }
  return OkStatus();
}

[[nodiscard]] Status WriteVarint(
    BufferWriter& writer,
    uint64_t value) noexcept {
  do {
    uint8_t byte = static_cast<uint8_t>(value & 0x7f);
    value >>= 7;
    if (value != 0) {
      byte |= 0x80;
    }
    Status status = writer.AppendByte(byte);
    if (!status.ok()) {
      return status;
    }
  } while (value != 0);
  return OkStatus();
}

[[nodiscard]] Status WriteKey(
    BufferWriter& writer,
    uint32_t fieldNumber,
    uint8_t wireType) noexcept {
  return WriteVarint(
      writer, (static_cast<uint64_t>(fieldNumber) << 3) | wireType);
}

[[nodiscard]] Status ReadVarint(Cursor& cursor, uint64_t& out) noexcept {
  uint64_t value = 0;
  for (size_t i = 0; i < 10; ++i) {
    if (cursor.offset >= cursor.bytes.size()) {
      return Status::DataLoss();
    }
    const uint8_t byte = cursor.bytes[cursor.offset++];
    if (i == 9 && (byte & 0xfe) != 0) {
      return Status::DataLoss();
    }
    value |= static_cast<uint64_t>(byte & 0x7f) << (i * 7);
    if ((byte & 0x80) == 0) {
      out = value;
      return OkStatus();
    }
  }
  return Status::DataLoss();
}

[[nodiscard]] TransportFrameDecodeResult SkipField(
    Cursor& cursor,
    uint8_t wireType) noexcept {
  switch (wireType) {
    case kWireTypeVarint: {
      uint64_t ignored = 0;
      Status status = ReadVarint(cursor, ignored);
      if (!status.ok()) {
        return DecodeFailure(
            status, TransportFrameDecodeError::MalformedVarint);
      }
      return {};
    }
    case kWireTypeFixed64:
      if (cursor.bytes.size() - cursor.offset < 8) {
        return DecodeFailure(
            Status::DataLoss(),
            TransportFrameDecodeError::PayloadLengthOutOfRange);
      }
      cursor.offset += 8;
      return {};
    case kWireTypeDelimited: {
      uint64_t len = 0;
      Status status = ReadVarint(cursor, len);
      if (!status.ok()) {
        return DecodeFailure(
            status, TransportFrameDecodeError::MalformedVarint);
      }
      if (len > cursor.bytes.size() - cursor.offset) {
        return DecodeFailure(
            Status::DataLoss(),
            TransportFrameDecodeError::PayloadLengthOutOfRange);
      }
      cursor.offset += static_cast<size_t>(len);
      return {};
    }
    case kWireTypeFixed32:
      if (cursor.bytes.size() - cursor.offset < 4) {
        return DecodeFailure(
            Status::DataLoss(),
            TransportFrameDecodeError::PayloadLengthOutOfRange);
      }
      cursor.offset += 4;
      return {};
    default:
      return DecodeFailure(
          Status::DataLoss(), TransportFrameDecodeError::WrongWireType);
  }
}

void CopyBytes(ConstByteSpan from, ByteSpan to) noexcept {
  for (size_t i = 0; i < from.size(); ++i) {
    to[i] = from[i];
  }
}

[[nodiscard]] InboundFrameResult InboundResult(
    InboundFrameStatus frameStatus,
    Status status,
    size_t size) noexcept {
  return InboundFrameResult{frameStatus, status, size};
}

} // namespace

size_t EncodedTransportFrameSize(TransportFrameView frame) noexcept {
  size_t size = 0;
  if (!ComputeEncodedTransportFrameSize(frame, size)) {
    return 0;
  }
  return size;
}

StatusWithSize EncodeTransportFrame(
    TransportFrameView frame,
    ByteSpan out) noexcept {
  if (!IsValidInput(frame.payload) || !IsValidOutput(out)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  if (frame.total_chunks == 0 || frame.chunk_index >= frame.total_chunks) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  size_t encodedSize = 0;
  if (!ComputeEncodedTransportFrameSize(frame, encodedSize)) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  Status status = ValidateOutputAtLeast(out, encodedSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  BufferWriter writer(out.subspan(0, encodedSize));
  if (frame.chunk_id != 0) {
    status = WriteKey(writer, kChunkIdField, kWireTypeVarint);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
    status = WriteVarint(writer, frame.chunk_id);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }
  if (frame.chunk_index != 0) {
    status = WriteKey(writer, kChunkIndexField, kWireTypeVarint);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
    status = WriteVarint(writer, frame.chunk_index);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }
  status = WriteKey(writer, kTotalChunksField, kWireTypeVarint);
  if (!status.ok()) {
    return StatusWithSize(status, writer.written());
  }
  status = WriteVarint(writer, frame.total_chunks);
  if (!status.ok()) {
    return StatusWithSize(status, writer.written());
  }
  if (!frame.payload.empty()) {
    status = WriteKey(writer, kPayloadField, kWireTypeDelimited);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
    status = WriteVarint(writer, frame.payload.size());
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
    status = writer.Append(frame.payload);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }

  return StatusWithSize(writer.status(), writer.written());
}

TransportFrameDecodeResult DecodeTransportFrameDetailed(
    ConstByteSpan bytes,
    DecodedTransportFrame& out) noexcept {
  if (!IsValidInput(bytes)) {
    return DecodeFailure(
        Status::InvalidArgument(), TransportFrameDecodeError::InvalidFieldKey);
  }

  Cursor cursor{bytes, 0};
  DecodedTransportFrame decoded;
  bool sawChunkId = false;
  bool sawChunkIndex = false;
  bool sawTotalChunks = false;

  while (cursor.offset < cursor.bytes.size()) {
    uint64_t key = 0;
    Status status = ReadVarint(cursor, key);
    if (!status.ok()) {
      return DecodeFailure(status, TransportFrameDecodeError::MalformedVarint);
    }
    const uint8_t wireType = static_cast<uint8_t>(key & 0x07);
    const uint64_t fieldNumber = key >> 3;
    if (!ValidFieldNumber(fieldNumber) || !IsValidWireType(wireType)) {
      return DecodeFailure(
          Status::DataLoss(), TransportFrameDecodeError::InvalidFieldKey);
    }

    switch (fieldNumber) {
      case kChunkIdField: {
        if (wireType != kWireTypeVarint) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::WrongWireType);
        }
        if (sawChunkId) {
          return DecodeFailure(
              Status::DataLoss(),
              TransportFrameDecodeError::DuplicateScalarField);
        }
        status = ReadVarint(cursor, decoded.chunk_id);
        if (!status.ok()) {
          return DecodeFailure(
              status, TransportFrameDecodeError::MalformedVarint);
        }
        sawChunkId = true;
        break;
      }
      case kChunkIndexField: {
        if (wireType != kWireTypeVarint) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::WrongWireType);
        }
        if (sawChunkIndex) {
          return DecodeFailure(
              Status::DataLoss(),
              TransportFrameDecodeError::DuplicateScalarField);
        }
        uint64_t value = 0;
        status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return DecodeFailure(
              status, TransportFrameDecodeError::MalformedVarint);
        }
        if (value > std::numeric_limits<uint32_t>::max()) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::MalformedVarint);
        }
        decoded.chunk_index = static_cast<uint32_t>(value);
        sawChunkIndex = true;
        break;
      }
      case kTotalChunksField: {
        if (wireType != kWireTypeVarint) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::WrongWireType);
        }
        if (sawTotalChunks) {
          return DecodeFailure(
              Status::DataLoss(),
              TransportFrameDecodeError::DuplicateScalarField);
        }
        uint64_t value = 0;
        status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return DecodeFailure(
              status, TransportFrameDecodeError::MalformedVarint);
        }
        if (value > std::numeric_limits<uint32_t>::max()) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::MalformedVarint);
        }
        decoded.total_chunks = static_cast<uint32_t>(value);
        sawTotalChunks = true;
        break;
      }
      case kPayloadField: {
        if (wireType != kWireTypeDelimited) {
          return DecodeFailure(
              Status::DataLoss(), TransportFrameDecodeError::WrongWireType);
        }
        uint64_t len = 0;
        status = ReadVarint(cursor, len);
        if (!status.ok()) {
          return DecodeFailure(
              status, TransportFrameDecodeError::MalformedVarint);
        }
        if (len > cursor.bytes.size() - cursor.offset) {
          return DecodeFailure(
              Status::DataLoss(),
              TransportFrameDecodeError::PayloadLengthOutOfRange);
        }
        decoded.payload = ConstByteSpan(
            cursor.bytes.data() + cursor.offset, static_cast<size_t>(len));
        cursor.offset += static_cast<size_t>(len);
        break;
      }
      default: {
        TransportFrameDecodeResult result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
      }
    }
  }

  if (!sawTotalChunks) {
    return DecodeFailure(
        Status::InvalidArgument(),
        TransportFrameDecodeError::MissingTotalChunks);
  }
  if (decoded.total_chunks == 0) {
    return DecodeFailure(
        Status::InvalidArgument(),
        TransportFrameDecodeError::InvalidTotalChunks);
  }
  if (decoded.chunk_index >= decoded.total_chunks) {
    return DecodeFailure(
        Status::InvalidArgument(),
        TransportFrameDecodeError::ChunkIndexOutOfRange);
  }

  out = decoded;
  return {};
}

Status DecodeTransportFrame(
    ConstByteSpan bytes,
    DecodedTransportFrame& out) noexcept {
  return DecodeTransportFrameDetailed(bytes, out).status;
}

Status OrderedTransportFramer::StartOutboundMessage(
    ConstByteSpan message) noexcept {
  if (outboundActive_) {
    return Status::FailedPrecondition();
  }
  if (!IsValidInput(message)) {
    return Status::InvalidArgument();
  }
  if (message.size() > kMaxReassembledLen) {
    return Status::ResourceExhausted();
  }

  const uint32_t totalChunks = message.empty()
      ? 1
      : static_cast<uint32_t>(
            (message.size() + kMaxChunkPayload - 1) / kMaxChunkPayload);
  if (totalChunks == 0 || totalChunks > kMaxTotalChunks) {
    return Status::ResourceExhausted();
  }

  uint64_t chunkId = 0;
  Status status = GenerateChunkId(chunkId);
  if (!status.ok()) {
    return status;
  }

  outboundMessage_ = message;
  outboundChunkId_ = chunkId;
  outboundTotalChunks_ = totalChunks;
  outboundNextIndex_ = 0;
  outboundActive_ = true;
  return OkStatus();
}

StatusWithSize OrderedTransportFramer::EncodeNextOutboundFrame(
    ByteSpan out) noexcept {
  if (!outboundActive_) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }

  const size_t offset = outboundMessage_.empty()
      ? 0
      : static_cast<size_t>(outboundNextIndex_) * kMaxChunkPayload;
  const size_t remaining = outboundMessage_.size() - offset;
  const size_t payloadLen = std::min(remaining, kMaxChunkPayload);
  const uint8_t* payload =
      payloadLen == 0 ? nullptr : outboundMessage_.data() + offset;
  const TransportFrameView frame{
      outboundChunkId_,
      outboundNextIndex_,
      outboundTotalChunks_,
      ConstByteSpan(payload, payloadLen)};

  StatusWithSize result = EncodeTransportFrame(frame, out);
  if (!result.ok()) {
    return result;
  }

  ++outboundNextIndex_;
  if (outboundNextIndex_ >= outboundTotalChunks_) {
    outboundActive_ = false;
    outboundMessage_ = ConstByteSpan();
    outboundTotalChunks_ = 0;
    outboundNextIndex_ = 0;
  }
  return result;
}

OrderedTransportFramer::InPlaceFrame
OrderedTransportFramer::EncodeSingleFrameInPlace(
    ByteSpan buffer,
    size_t messageOffset,
    size_t messageSize) noexcept {
  if (outboundActive_) {
    return InPlaceFrame{Status::FailedPrecondition(), 0, 0};
  }
  if (!IsValidOutput(buffer) || messageSize == 0 ||
      messageOffset > buffer.size() ||
      messageSize > buffer.size() - messageOffset) {
    return InPlaceFrame{Status::InvalidArgument(), 0, 0};
  }
  if (messageSize > kMaxChunkPayload) {
    return InPlaceFrame{Status::ResourceExhausted(), 0, 0};
  }

  uint64_t chunkId = 0;
  Status status = GenerateChunkId(chunkId);
  if (!status.ok()) {
    return InPlaceFrame{status, 0, 0};
  }
  const TransportFrameView frame{
      chunkId,
      0,
      1,
      ConstByteSpan(buffer.data() + messageOffset, messageSize)};
  size_t frameSize = 0;
  if (!ComputeEncodedTransportFrameSize(frame, frameSize) ||
      frameSize <= messageSize) {
    return InPlaceFrame{Status::ResourceExhausted(), 0, 0};
  }
  const size_t prefixSize = frameSize - messageSize;
  if (prefixSize > messageOffset) {
    return InPlaceFrame{Status::ResourceExhausted(), 0, 0};
  }

  // The same fields, in the same order, as EncodeTransportFrame writes ahead
  // of the payload (chunk_index 0 is omitted).
  const size_t start = messageOffset - prefixSize;
  BufferWriter writer(buffer.subspan(start, prefixSize));
  if (chunkId != 0) {
    status = WriteKey(writer, kChunkIdField, kWireTypeVarint);
    if (status.ok()) {
      status = WriteVarint(writer, chunkId);
    }
  }
  if (status.ok()) {
    status = WriteKey(writer, kTotalChunksField, kWireTypeVarint);
  }
  if (status.ok()) {
    status = WriteVarint(writer, 1);
  }
  if (status.ok()) {
    status = WriteKey(writer, kPayloadField, kWireTypeDelimited);
  }
  if (status.ok()) {
    status = WriteVarint(writer, messageSize);
  }
  if (!status.ok() || writer.written() != prefixSize) {
    return InPlaceFrame{status.ok() ? Status::Internal() : status, 0, 0};
  }
  return InPlaceFrame{OkStatus(), start, frameSize};
}

InboundFrameResult OrderedTransportFramer::DecodeAndAppendInboundFrame(
    ConstByteSpan frameBytes,
    ByteSpan messageOut) noexcept {
  return DecodeInbound(frameBytes, messageOut, nullptr);
}

InboundFrameResult OrderedTransportFramer::DecodeInboundFrame(
    ConstByteSpan frameBytes,
    ByteSpan messageOut,
    ConstByteSpan& message) noexcept {
  message = ConstByteSpan();
  InboundFrameResult result = DecodeInbound(frameBytes, messageOut, &message);
  if (result.frame_status == InboundFrameStatus::Complete &&
      message.data() == nullptr && result.size != 0) {
    message = ConstByteSpan(messageOut.data(), result.size);
  }
  return result;
}

InboundFrameResult OrderedTransportFramer::DecodeInbound(
    ConstByteSpan frameBytes,
    ByteSpan messageOut,
    ConstByteSpan* view) noexcept {
  if (inboundPoisoned_) {
    return InboundResult(
        InboundFrameStatus::Violation, Status::FailedPrecondition(), 0);
  }
  if (!IsValidOutput(messageOut)) {
    return InboundResult(
        InboundFrameStatus::NeedMore, Status::InvalidArgument(), inboundBytes_);
  }

  DecodedTransportFrame frame;
  TransportFrameDecodeResult decodeResult =
      DecodeTransportFrameDetailed(frameBytes, frame);
  if (!decodeResult.ok()) {
    return PoisonInbound(decodeResult.status);
  }
  if (frame.total_chunks > kMaxTotalChunks) {
    return PoisonInbound(Status::InvalidArgument());
  }

  const bool starting = !inboundActive_;
  if (starting) {
    if (frame.chunk_index != 0) {
      return PoisonInbound(Status::DataLoss());
    }
  } else if (
      frame.chunk_id != inboundChunkId_ ||
      frame.total_chunks != inboundTotalChunks_ ||
      frame.chunk_index != inboundNextIndex_) {
    return PoisonInbound(Status::DataLoss());
  }

  if (frame.payload.size() > kMaxReassembledLen - inboundBytes_) {
    return PoisonInbound(Status::ResourceExhausted());
  }
  if (view != nullptr && starting && frame.total_chunks == 1) {
    // The whole message is in this frame: hand it back where it is.
    *view = frame.payload;
    return InboundResult(
        InboundFrameStatus::Complete, OkStatus(), frame.payload.size());
  }
  const size_t newSize = inboundBytes_ + frame.payload.size();
  if (messageOut.size() < newSize) {
    return InboundResult(
        InboundFrameStatus::NeedMore,
        Status::ResourceExhausted(),
        inboundBytes_);
  }
  if (newSize != 0 && messageOut.data() == nullptr) {
    return InboundResult(
        InboundFrameStatus::NeedMore, Status::InvalidArgument(), inboundBytes_);
  }

  if (starting) {
    inboundActive_ = true;
    inboundChunkId_ = frame.chunk_id;
    inboundTotalChunks_ = frame.total_chunks;
    inboundNextIndex_ = 0;
    inboundBytes_ = 0;
  }

  CopyBytes(
      frame.payload, messageOut.subspan(inboundBytes_, frame.payload.size()));
  inboundBytes_ = newSize;
  ++inboundNextIndex_;

  if (inboundNextIndex_ == inboundTotalChunks_) {
    const size_t completedSize = inboundBytes_;
    inboundActive_ = false;
    inboundChunkId_ = 0;
    inboundTotalChunks_ = 0;
    inboundNextIndex_ = 0;
    inboundBytes_ = 0;
    return InboundResult(
        InboundFrameStatus::Complete, OkStatus(), completedSize);
  }

  return InboundResult(InboundFrameStatus::NeedMore, OkStatus(), inboundBytes_);
}

OrderedTransportFramer::InboundStateSnapshot
OrderedTransportFramer::SnapshotInboundState() const noexcept {
  return InboundStateSnapshot{
      inboundChunkId_,
      inboundTotalChunks_,
      inboundNextIndex_,
      inboundBytes_,
      inboundActive_,
      inboundPoisoned_};
}

void OrderedTransportFramer::RestoreInboundState(
    InboundStateSnapshot snapshot) noexcept {
  inboundChunkId_ = snapshot.chunk_id;
  inboundTotalChunks_ = snapshot.total_chunks;
  inboundNextIndex_ = snapshot.next_index;
  inboundBytes_ = snapshot.bytes;
  inboundActive_ = snapshot.active;
  inboundPoisoned_ = snapshot.poisoned;
}

void OrderedTransportFramer::ResetInbound() noexcept {
  inboundChunkId_ = 0;
  inboundTotalChunks_ = 0;
  inboundNextIndex_ = 0;
  inboundBytes_ = 0;
  inboundActive_ = false;
  inboundPoisoned_ = false;
}

Status OrderedTransportFramer::GenerateChunkId(uint64_t& chunkId) noexcept {
  if (hasNextChunkIdOverride_) {
    chunkId = nextChunkIdOverride_;
    hasNextChunkIdOverride_ = false;
    return OkStatus();
  }

  if (backend_ == nullptr) {
    return Status::FailedPrecondition();
  }

  std::array<uint8_t, sizeof(uint64_t)> randomBytes{};
  Status status = backend_->Random(ByteSpan(randomBytes));
  if (!status.ok()) {
    return status;
  }

  uint64_t value = 0;
  for (size_t i = 0; i < randomBytes.size(); ++i) {
    value |= static_cast<uint64_t>(randomBytes[i]) << (i * 8);
  }
  chunkId = value;
  return OkStatus();
}

InboundFrameResult OrderedTransportFramer::PoisonInbound(
    Status status) noexcept {
  inboundPoisoned_ = true;
  inboundActive_ = false;
  inboundChunkId_ = 0;
  inboundTotalChunks_ = 0;
  inboundNextIndex_ = 0;
  inboundBytes_ = 0;
  return InboundResult(InboundFrameStatus::Violation, status, 0);
}

} // namespace musegadgets::noise::core
