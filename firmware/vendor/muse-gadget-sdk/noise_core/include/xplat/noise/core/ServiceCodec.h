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

#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>
#include <xplat/noise/core/StringView.h>

namespace musegadgets::noise::core {

enum class ServiceType : int32_t {
  Daemon = 0,
  Sentinel = 1,
  Vault = 2,
  Authd = 3,
};

struct HeaderView {
  StringView key;
  StringView value;
};

struct ApplicationRequestView {
  StringView verb;
  StringView path;
  Span<const HeaderView> headers;
  ConstByteSpan body;
  bool end_body{false};
};

struct ApplicationResponseView {
  int32_t status{0};
  Span<const HeaderView> headers;
  ConstByteSpan body;
  bool end_body{false};
};

struct BodyChunkView {
  ConstByteSpan data;
  bool end_body{false};
};

enum class ResetCode : int32_t {
  Unspecified = 0,
  Cancelled = 1,
  Timeout = 2,
  ProtocolError = 3,
  RefusedStream = 4,
  InternalError = 5,
  ServiceUnavailable = 6,
};

struct ResetView {
  ResetCode code{ResetCode::Unspecified};
  StringView reason;
};

enum class ServiceFrameKind : uint8_t {
  None,
  Request,
  Response,
  BodyChunk,
  Reset,
};

struct ServiceFrameView {
  int64_t stream_id{0};
  ServiceFrameKind kind{ServiceFrameKind::None};
  ApplicationRequestView request;
  ApplicationResponseView response;
  BodyChunkView body_chunk;
  ResetView reset;
};

using DecodedServiceFrame = ServiceFrameView;

struct DecodedServiceRequestEnvelope {
  ServiceType service{ServiceType::Daemon};
  ConstByteSpan payload;
};

struct DecodedServiceResponseEnvelope {
  ConstByteSpan payload;
};

enum class ServiceCodecError : uint8_t {
  None,
  MalformedVarint,
  InvalidFieldKey,
  WrongWireType,
  LengthOutOfRange,
  ValueOutOfRange,
  HeaderStorageTooSmall,
  UnknownEnvelopeService,
  EmptyEnvelopePayload,
  UnknownServiceFrameKind,
  UnexpectedRequestFrame,
  InvalidClientFrameKind,
  StreamIdReserved,
  RequestPathInvalid,
};

struct ServiceCodecResult {
  Status status{OkStatus()};
  ServiceCodecError error{ServiceCodecError::None};
  size_t required_headers{0};

  [[nodiscard]] constexpr bool ok() const noexcept {
    return status.ok();
  }
};

[[nodiscard]] StringView ResetCodeName(ResetCode code) noexcept;

[[nodiscard]] size_t ServiceRequestEnvelopeSize(
    ServiceType service,
    size_t payloadSize) noexcept;

[[nodiscard]] size_t ServiceResponseEnvelopeSize(size_t payloadSize) noexcept;

[[nodiscard]] StatusWithSize EncodeServiceRequestEnvelope(
    ServiceType service,
    ConstByteSpan payload,
    ByteSpan out) noexcept;

[[nodiscard]] StatusWithSize EncodeServiceResponseEnvelope(
    ConstByteSpan payload,
    ByteSpan out) noexcept;

[[nodiscard]] size_t EncodedServiceFrameSize(ServiceFrameView frame) noexcept;

[[nodiscard]] StatusWithSize EncodeServiceFrame(
    ServiceFrameView frame,
    ByteSpan out) noexcept;

[[nodiscard]] StatusWithSize EncodeApplicationRequestFrame(
    int64_t streamId,
    ApplicationRequestView request,
    ByteSpan out) noexcept;

[[nodiscard]] StatusWithSize EncodeBodyChunkFrame(
    int64_t streamId,
    BodyChunkView chunk,
    ByteSpan out) noexcept;

[[nodiscard]] StatusWithSize
EncodeResetFrame(int64_t streamId, ResetView reset, ByteSpan out) noexcept;

// Writes the bytes that come before the data in a request envelope carrying
// one BodyChunk frame with end_body false. That envelope is exactly this
// prefix followed by the data, so a caller can encode a chunk around data that
// is already in place. Returns the prefix size; dataSize must be non-zero.
[[nodiscard]] StatusWithSize EncodeBodyChunkRequestPrefix(
    ServiceType service,
    int64_t streamId,
    size_t dataSize,
    ByteSpan out) noexcept;

[[nodiscard]] ServiceCodecResult DecodeServiceRequestEnvelopeDetailed(
    ConstByteSpan bytes,
    DecodedServiceRequestEnvelope& out) noexcept;

[[nodiscard]] ServiceCodecResult DecodeServiceResponseEnvelopeDetailed(
    ConstByteSpan bytes,
    DecodedServiceResponseEnvelope& out) noexcept;

[[nodiscard]] ServiceCodecResult DecodeServiceFrameDetailed(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    DecodedServiceFrame& out) noexcept;

[[nodiscard]] ServiceCodecResult DecodeServerServiceFrameDetailed(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    DecodedServiceFrame& out) noexcept;

[[nodiscard]] ServiceCodecResult ValidateClientEnvelopeDetailed(
    ConstByteSpan bytes) noexcept;

[[nodiscard]] Status ValidateClientEnvelope(ConstByteSpan bytes) noexcept;

} // namespace musegadgets::noise::core
