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

#include <xplat/noise/core/ClientSession.h>

#include <xplat/noise/core/Secret.h>

#include <algorithm>
#include <cstdint>

namespace musegadgets::noise::core {
namespace {

[[nodiscard]] bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

[[nodiscard]] bool RangesOverlap(
    const uint8_t* lhs,
    size_t lhsSize,
    const uint8_t* rhs,
    size_t rhsSize) noexcept {
  if (lhsSize == 0 || rhsSize == 0 || lhs == nullptr || rhs == nullptr) {
    return false;
  }
  const uintptr_t lhsBegin = reinterpret_cast<uintptr_t>(lhs);
  const uintptr_t rhsBegin = reinterpret_cast<uintptr_t>(rhs);
  const uintptr_t lhsEnd = lhsBegin + lhsSize;
  const uintptr_t rhsEnd = rhsBegin + rhsSize;
  return lhsBegin < rhsEnd && rhsBegin < lhsEnd;
}

[[nodiscard]] bool ScratchBuffersOverlap(ByteSpan lhs, ByteSpan rhs) noexcept {
  return RangesOverlap(lhs.data(), lhs.size(), rhs.data(), rhs.size());
}

[[nodiscard]] ClientSessionInboundResult InboundFailure(
    InboundFrameStatus frameStatus,
    Status status,
    ServiceCodecError serviceError = ServiceCodecError::None,
    size_t size = 0,
    size_t requiredHeaders = 0) noexcept {
  return ClientSessionInboundResult{
      frameStatus, status, serviceError, size, requiredHeaders, {}};
}

[[nodiscard]] ClientSessionInboundResult InboundFromFrameResult(
    InboundFrameResult frameResult) noexcept {
  return ClientSessionInboundResult{
      frameResult.frame_status,
      frameResult.status,
      ServiceCodecError::None,
      frameResult.size,
      0,
      {}};
}

[[nodiscard]] InboundFrameStatus FrameStatusForOpenFailure(
    Status status) noexcept {
  return status.IsResourceExhausted() ? InboundFrameStatus::NeedMore
                                      : InboundFrameStatus::Violation;
}

} // namespace

ClientSession::ClientSession(CryptoBackend& backend) noexcept
    : backend_(backend), handshake_(backend), framer_(&backend) {}

ClientSession::~ClientSession() noexcept = default;

bool ClientSession::isEstablished() const noexcept {
  return stage_ == Stage::Established && transport_.has_value();
}

bool ClientSession::HasOutboundWebSocketPayload() const noexcept {
  return framer_.HasOutboundMessage();
}

StatusWithSize ClientSession::WriteHandshakeMessage1(
    ByteSpan websocketPayloadOut) noexcept {
  if (stage_ != Stage::Init) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }

  StatusWithSize result = handshake_.WriteMessage1(websocketPayloadOut);
  if (result.ok()) {
    stage_ = Stage::WroteMessage1;
  } else if (!result.status().IsResourceExhausted()) {
    stage_ = Stage::Failed;
  }
  return StatusWithSize(result.status(), result.size());
}

Status ClientSession::ReadHandshakeMessage2(
    ConstByteSpan websocketPayload,
    ByteSpan peerExtraScratchOut,
    size_t& peerExtraWritten) noexcept {
  peerExtraWritten = 0;
  if (stage_ != Stage::WroteMessage1) {
    return Status::FailedPrecondition();
  }

  Status status = handshake_.ReadMessage2(
      websocketPayload, peerExtraScratchOut, peerExtraWritten);
  if (status.ok()) {
    stage_ = Stage::ReadMessage2;
  } else if (!status.IsResourceExhausted()) {
    stage_ = Stage::Failed;
  }
  return status;
}

StatusWithSize ClientSession::WriteHandshakeMessage3(
    ConstByteSpan authPayload,
    ByteSpan websocketPayloadOut) noexcept {
  if (stage_ != Stage::ReadMessage2) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }

  StatusWithSize result =
      handshake_.WriteMessage3(authPayload, websocketPayloadOut);
  if (!result.ok()) {
    if (!result.status().IsResourceExhausted()) {
      stage_ = Stage::Failed;
    }
    return StatusWithSize(result.status(), result.size());
  }

  SecretArray<Transport::kKeySize> sendKey;
  SecretArray<Transport::kKeySize> recvKey;
  Status status = handshake_.Finalize(sendKey.span(), recvKey.span());
  if (!status.ok()) {
    Zeroize(sendKey.span());
    Zeroize(recvKey.span());
    stage_ = Stage::Failed;
    return StatusWithSize(status, 0);
  }

  transport_.emplace(backend_, sendKey.span(), recvKey.span());
  Zeroize(sendKey.span());
  Zeroize(recvKey.span());

  status = transport_->status();
  if (!status.ok()) {
    transport_.reset();
    stage_ = Stage::Failed;
    return StatusWithSize(status, 0);
  }

  stage_ = Stage::Established;
  return StatusWithSize(result.status(), result.size());
}

StatusWithSize ClientSession::StartOutboundApplicationRequest(
    ServiceType service,
    int64_t streamId,
    ApplicationRequestView request,
    ByteSpan serviceFrameScratch,
    ByteSpan requestEnvelopeScratch) noexcept {
  return StartOutboundServiceFrame(
      service,
      ServiceFrameView{
          streamId, ServiceFrameKind::Request, request, {}, {}, {}},
      serviceFrameScratch,
      requestEnvelopeScratch);
}

StatusWithSize ClientSession::StartOutboundBodyChunk(
    ServiceType service,
    int64_t streamId,
    BodyChunkView chunk,
    ByteSpan serviceFrameScratch,
    ByteSpan requestEnvelopeScratch) noexcept {
  return StartOutboundServiceFrame(
      service,
      ServiceFrameView{
          streamId, ServiceFrameKind::BodyChunk, {}, {}, chunk, {}},
      serviceFrameScratch,
      requestEnvelopeScratch);
}

StatusWithSize ClientSession::StartOutboundReset(
    ServiceType service,
    int64_t streamId,
    ResetView reset,
    ByteSpan serviceFrameScratch,
    ByteSpan requestEnvelopeScratch) noexcept {
  return StartOutboundServiceFrame(
      service,
      ServiceFrameView{streamId, ServiceFrameKind::Reset, {}, {}, {}, reset},
      serviceFrameScratch,
      requestEnvelopeScratch);
}

StatusWithSize ClientSession::StartOutboundServiceFrame(
    ServiceType service,
    ServiceFrameView frame,
    ByteSpan serviceFrameScratch,
    ByteSpan requestEnvelopeScratch) noexcept {
  if (!isEstablished()) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (framer_.HasOutboundMessage()) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (ScratchBuffersOverlap(serviceFrameScratch, requestEnvelopeScratch)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  StatusWithSize frameResult = EncodeServiceFrame(frame, serviceFrameScratch);
  if (!frameResult.ok()) {
    return StatusWithSize(frameResult.status(), frameResult.size());
  }

  StatusWithSize envelopeResult = EncodeServiceRequestEnvelope(
      service,
      serviceFrameScratch.subspan(0, frameResult.size()),
      requestEnvelopeScratch);
  if (!envelopeResult.ok()) {
    return StatusWithSize(envelopeResult.status(), envelopeResult.size());
  }

  Status status = framer_.StartOutboundMessage(
      requestEnvelopeScratch.subspan(0, envelopeResult.size()));
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }
  return StatusWithSize(envelopeResult.status(), envelopeResult.size());
}

StatusWithSize ClientSession::WriteNextOutboundWebSocketPayload(
    ByteSpan websocketPayloadScratchAndOut) noexcept {
  if (!isEstablished()) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (!framer_.HasOutboundMessage()) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (!IsValidOutput(websocketPayloadScratchAndOut)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  // A buffer smaller than kMaxOutboundWebSocketPayloadSize is fine as long as
  // the next frame fits; EncodeNextOutboundFrame reports ResourceExhausted
  // otherwise and leaves the framer state unchanged.
  if (websocketPayloadScratchAndOut.size() <= Transport::kTagSize) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  StatusWithSize frameResult =
      framer_.EncodeNextOutboundFrame(websocketPayloadScratchAndOut.subspan(
          0,
          std::min(websocketPayloadScratchAndOut.size() - Transport::kTagSize,
                   OrderedTransportFramer::kMaxEncodedFrameSize)));
  if (!frameResult.ok()) {
    return StatusWithSize(frameResult.status(), frameResult.size());
  }

  StatusWithSize sealResult = transport_->SealInPlace(
      websocketPayloadScratchAndOut.subspan(
          0, frameResult.size() + Transport::kTagSize),
      frameResult.size());
  if (!sealResult.ok()) {
    stage_ = Stage::Failed;
  }
  return StatusWithSize(sealResult.status(), sealResult.size());
}

ClientSession::InPlacePayload ClientSession::SealBodyChunkInPlace(
    ServiceType service,
    int64_t streamId,
    ByteSpan buffer,
    size_t dataOffset,
    size_t dataSize) noexcept {
  if (!isEstablished() || framer_.HasOutboundMessage()) {
    return InPlacePayload{Status::FailedPrecondition(), 0, 0};
  }
  if (!IsValidOutput(buffer) || dataSize == 0 || dataOffset > buffer.size() ||
      dataSize > buffer.size() - dataOffset) {
    return InPlacePayload{Status::InvalidArgument(), 0, 0};
  }

  // The request envelope's prefix (envelope, service frame and chunk fields)
  // goes right before the data, and the transport frame's fields before it.
  uint8_t prefix[kMaxBodyChunkInPlaceHeadroom];
  StatusWithSize prefixResult = EncodeBodyChunkRequestPrefix(
      service, streamId, dataSize, ByteSpan(prefix, sizeof(prefix)));
  if (!prefixResult.ok()) {
    return InPlacePayload{prefixResult.status(), 0, 0};
  }
  const size_t prefixSize = prefixResult.size();
  if (prefixSize > dataOffset) {
    return InPlacePayload{Status::ResourceExhausted(), 0, 0};
  }
  const size_t envelopeOffset = dataOffset - prefixSize;

  const size_t envelopeSize = prefixSize + dataSize;
  if (buffer.size() - dataOffset - dataSize < Transport::kTagSize) {
    return InPlacePayload{Status::ResourceExhausted(), 0, 0};
  }

  for (size_t i = 0; i < prefixSize; ++i) {
    buffer[envelopeOffset + i] = prefix[i];
  }
  OrderedTransportFramer::InPlaceFrame frame =
      framer_.EncodeSingleFrameInPlace(buffer, envelopeOffset, envelopeSize);
  if (!frame.status.ok()) {
    return InPlacePayload{frame.status, 0, 0};
  }

  StatusWithSize sealResult = transport_->SealInPlace(
      buffer.subspan(frame.offset, frame.size + Transport::kTagSize),
      frame.size);
  if (!sealResult.ok()) {
    stage_ = Stage::Failed;
    return InPlacePayload{sealResult.status(), 0, 0};
  }
  return InPlacePayload{OkStatus(), frame.offset, sealResult.size()};
}

ClientSessionInboundResult ClientSession::ProcessInboundWebSocketPayload(
    ConstByteSpan websocketPayload,
    ByteSpan transportFrameScratch,
    ByteSpan serviceResponseScratch,
    Span<HeaderView> headerStorage) noexcept {
  if (!isEstablished()) {
    return InboundFailure(
        InboundFrameStatus::Violation, Status::FailedPrecondition());
  }

  const Transport::ReceiveStateSnapshot transportReceiveState =
      transport_->SnapshotReceiveState();
  const OrderedTransportFramer::InboundStateSnapshot framerInboundState =
      framer_.SnapshotInboundState();

  StatusWithSize openResult =
      transport_->Open(websocketPayload, transportFrameScratch);
  if (!openResult.ok()) {
    if (!openResult.status().IsResourceExhausted()) {
      stage_ = Stage::Failed;
    }
    return InboundFailure(
        FrameStatusForOpenFailure(openResult.status()), openResult.status());
  }

  ConstByteSpan message;
  InboundFrameResult frameResult = framer_.DecodeInboundFrame(
      transportFrameScratch.subspan(0, openResult.size()),
      serviceResponseScratch,
      message);
  if (!frameResult.status.ok() ||
      frameResult.frame_status != InboundFrameStatus::Complete) {
    if (frameResult.frame_status == InboundFrameStatus::NeedMore &&
        frameResult.status.IsResourceExhausted()) {
      transport_->RestoreReceiveState(transportReceiveState);
      framer_.RestoreInboundState(framerInboundState);
    } else if (frameResult.frame_status == InboundFrameStatus::Violation) {
      stage_ = Stage::Failed;
    }
    return InboundFromFrameResult(frameResult);
  }

  DecodedServiceResponseEnvelope envelope;
  ServiceCodecResult envelopeResult =
      DecodeServiceResponseEnvelopeDetailed(message, envelope);
  if (!envelopeResult.ok()) {
    stage_ = Stage::Failed;
    return InboundFailure(
        InboundFrameStatus::Violation,
        envelopeResult.status,
        envelopeResult.error,
        frameResult.size,
        envelopeResult.required_headers);
  }
  if (envelope.payload.empty()) {
    stage_ = Stage::Failed;
    return InboundFailure(
        InboundFrameStatus::Violation,
        Status::InvalidArgument(),
        ServiceCodecError::EmptyEnvelopePayload,
        frameResult.size);
  }

  DecodedServiceFrame decodedFrame;
  ServiceCodecResult serviceResult = DecodeServerServiceFrameDetailed(
      envelope.payload, headerStorage, decodedFrame);
  if (!serviceResult.ok()) {
    if (serviceResult.status.IsResourceExhausted() &&
        serviceResult.error == ServiceCodecError::HeaderStorageTooSmall) {
      transport_->RestoreReceiveState(transportReceiveState);
      framer_.RestoreInboundState(framerInboundState);
      return InboundFailure(
          InboundFrameStatus::NeedMore,
          serviceResult.status,
          serviceResult.error,
          frameResult.size,
          serviceResult.required_headers);
    }
    stage_ = Stage::Failed;
    return InboundFailure(
        InboundFrameStatus::Violation,
        serviceResult.status,
        serviceResult.error,
        frameResult.size,
        serviceResult.required_headers);
  }

  return ClientSessionInboundResult{
      InboundFrameStatus::Complete,
      OkStatus(),
      ServiceCodecError::None,
      frameResult.size,
      0,
      decodedFrame};
}

} // namespace musegadgets::noise::core
