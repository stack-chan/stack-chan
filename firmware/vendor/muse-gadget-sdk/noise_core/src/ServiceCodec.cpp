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

#include <xplat/noise/core/ServiceCodec.h>

#include <xplat/noise/core/BufferWriter.h>

#include <cstddef>
#include <cstdint>
#include <limits>

namespace musegadgets::noise::core {
namespace {

constexpr int64_t kReservedStreamId = 0;

constexpr uint32_t kServiceRequestServiceField = 1;
constexpr uint32_t kServiceRequestPayloadField = 2;

constexpr uint32_t kServiceResponsePayloadField = 1;

constexpr uint32_t kServiceFrameStreamIdField = 1;
constexpr uint32_t kServiceFrameRequestField = 2;
constexpr uint32_t kServiceFrameResponseField = 3;
constexpr uint32_t kServiceFrameBodyChunkField = 4;
constexpr uint32_t kServiceFrameResetField = 5;

constexpr uint32_t kHeaderKeyField = 1;
constexpr uint32_t kHeaderValueField = 2;

constexpr uint32_t kApplicationRequestVerbField = 1;
constexpr uint32_t kApplicationRequestPathField = 2;
constexpr uint32_t kApplicationRequestHeadersField = 3;
constexpr uint32_t kApplicationRequestBodyField = 4;
constexpr uint32_t kApplicationRequestEndBodyField = 5;

constexpr uint32_t kApplicationResponseStatusField = 1;
constexpr uint32_t kApplicationResponseHeadersField = 2;
constexpr uint32_t kApplicationResponseBodyField = 3;
constexpr uint32_t kApplicationResponseEndBodyField = 4;

constexpr uint32_t kBodyChunkDataField = 1;
constexpr uint32_t kBodyChunkEndBodyField = 2;

constexpr uint32_t kResetCodeField = 1;
constexpr uint32_t kResetReasonField = 2;

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

struct TopLevelServiceFrame {
  int64_t stream_id{0};
  ServiceFrameKind kind{ServiceFrameKind::None};
  ConstByteSpan payload;
};

[[nodiscard]] bool IsValidInput(ConstByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

[[nodiscard]] bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

[[nodiscard]] bool IsValidString(StringView value) noexcept {
  return value.data() != nullptr || value.empty();
}

[[nodiscard]] bool IsValidHeaders(Span<const HeaderView> headers) noexcept {
  if (headers.data() == nullptr && !headers.empty()) {
    return false;
  }
  for (size_t i = 0; i < headers.size(); ++i) {
    if (!IsValidString(headers[i].key) || !IsValidString(headers[i].value)) {
      return false;
    }
  }
  return true;
}

[[nodiscard]] bool IsValidHeaderStorage(
    Span<HeaderView> headerStorage) noexcept {
  return headerStorage.data() != nullptr || headerStorage.empty();
}

[[nodiscard]] bool IsKnownServiceType(ServiceType service) noexcept {
  return service == ServiceType::Daemon || service == ServiceType::Sentinel ||
      service == ServiceType::Vault || service == ServiceType::Authd;
}

[[nodiscard]] bool IsKnownServiceValue(uint64_t service) noexcept {
  return service <= static_cast<uint64_t>(ServiceType::Authd);
}

[[nodiscard]] bool IsValidFieldNumber(uint64_t fieldNumber) noexcept {
  return fieldNumber != 0 && fieldNumber <= kMaxFieldNumber &&
      !(fieldNumber >= kFirstReservedFieldNumber &&
        fieldNumber <= kLastReservedFieldNumber);
}

[[nodiscard]] bool IsValidWireType(uint8_t wireType) noexcept {
  return wireType == kWireTypeVarint || wireType == kWireTypeFixed64 ||
      wireType == kWireTypeDelimited || wireType == kWireTypeFixed32;
}

[[nodiscard]] ServiceCodecResult Failure(
    Status status,
    ServiceCodecError error,
    size_t requiredHeaders = 0) noexcept {
  return ServiceCodecResult{status, error, requiredHeaders};
}

[[nodiscard]] size_t VarintSize(uint64_t value) noexcept {
  size_t size = 1;
  while (value >= 0x80) {
    value >>= 7;
    ++size;
  }
  return size;
}

[[nodiscard]] uint64_t SignedVarintValue(int64_t value) noexcept {
  return static_cast<uint64_t>(value);
}

[[nodiscard]] uint64_t SignedVarintValue(int32_t value) noexcept {
  return static_cast<uint64_t>(static_cast<int64_t>(value));
}

[[nodiscard]] uint64_t Key(uint32_t fieldNumber, uint8_t wireType) noexcept {
  return (static_cast<uint64_t>(fieldNumber) << 3) | wireType;
}

[[nodiscard]] bool AddSize(size_t addend, size_t& total) noexcept {
  if (addend > std::numeric_limits<size_t>::max() - total) {
    return false;
  }
  total += addend;
  return true;
}

[[nodiscard]] bool AddDelimitedFieldSize(
    uint32_t fieldNumber,
    size_t payloadSize,
    size_t& total) noexcept {
  return AddSize(VarintSize(Key(fieldNumber, kWireTypeDelimited)), total) &&
      AddSize(VarintSize(payloadSize), total) && AddSize(payloadSize, total);
}

[[nodiscard]] bool AddVarintFieldSize(
    uint32_t fieldNumber,
    uint64_t value,
    size_t& total) noexcept {
  return AddSize(VarintSize(Key(fieldNumber, kWireTypeVarint)), total) &&
      AddSize(VarintSize(value), total);
}

[[nodiscard]] ConstByteSpan StringBytes(StringView value) noexcept {
  if (value.empty()) {
    return ConstByteSpan();
  }
  return ConstByteSpan(
      reinterpret_cast<const uint8_t*>(value.data()), value.size());
}

[[nodiscard]] StringView StringFromBytes(ConstByteSpan bytes) noexcept {
  if (bytes.empty()) {
    return StringView();
  }
  return StringView(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

[[nodiscard]] Span<const HeaderView> HeaderViewSpan(
    Span<HeaderView> headerStorage,
    size_t size) noexcept {
  if (size == 0) {
    return Span<const HeaderView>();
  }
  return Span<const HeaderView>(headerStorage.data(), size);
}

[[nodiscard]] bool ComputeHeaderSize(HeaderView header, size_t& out) noexcept {
  size_t size = 0;
  if (!header.key.empty() &&
      !AddDelimitedFieldSize(kHeaderKeyField, header.key.size(), size)) {
    return false;
  }
  if (!header.value.empty() &&
      !AddDelimitedFieldSize(kHeaderValueField, header.value.size(), size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeApplicationRequestSize(
    ApplicationRequestView request,
    size_t& out) noexcept {
  size_t size = 0;
  if (!request.verb.empty() &&
      !AddDelimitedFieldSize(
          kApplicationRequestVerbField, request.verb.size(), size)) {
    return false;
  }
  if (!request.path.empty() &&
      !AddDelimitedFieldSize(
          kApplicationRequestPathField, request.path.size(), size)) {
    return false;
  }
  for (size_t i = 0; i < request.headers.size(); ++i) {
    size_t headerSize = 0;
    if (!ComputeHeaderSize(request.headers[i], headerSize) ||
        !AddDelimitedFieldSize(
            kApplicationRequestHeadersField, headerSize, size)) {
      return false;
    }
  }
  if (!request.body.empty() &&
      !AddDelimitedFieldSize(
          kApplicationRequestBodyField, request.body.size(), size)) {
    return false;
  }
  if (request.end_body &&
      !AddVarintFieldSize(kApplicationRequestEndBodyField, 1, size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeApplicationResponseSize(
    ApplicationResponseView response,
    size_t& out) noexcept {
  size_t size = 0;
  if (response.status != 0 &&
      !AddVarintFieldSize(
          kApplicationResponseStatusField,
          SignedVarintValue(response.status),
          size)) {
    return false;
  }
  for (size_t i = 0; i < response.headers.size(); ++i) {
    size_t headerSize = 0;
    if (!ComputeHeaderSize(response.headers[i], headerSize) ||
        !AddDelimitedFieldSize(
            kApplicationResponseHeadersField, headerSize, size)) {
      return false;
    }
  }
  if (!response.body.empty() &&
      !AddDelimitedFieldSize(
          kApplicationResponseBodyField, response.body.size(), size)) {
    return false;
  }
  if (response.end_body &&
      !AddVarintFieldSize(kApplicationResponseEndBodyField, 1, size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeBodyChunkSize(
    BodyChunkView chunk,
    size_t& out) noexcept {
  size_t size = 0;
  if (!chunk.data.empty() &&
      !AddDelimitedFieldSize(kBodyChunkDataField, chunk.data.size(), size)) {
    return false;
  }
  if (chunk.end_body && !AddVarintFieldSize(kBodyChunkEndBodyField, 1, size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeResetSize(ResetView reset, size_t& out) noexcept {
  size_t size = 0;
  if (reset.code != ResetCode::Unspecified &&
      !AddVarintFieldSize(
          kResetCodeField,
          SignedVarintValue(static_cast<int32_t>(reset.code)),
          size)) {
    return false;
  }
  if (!reset.reason.empty() &&
      !AddDelimitedFieldSize(kResetReasonField, reset.reason.size(), size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeServiceFrameSize(
    ServiceFrameView frame,
    size_t& out) noexcept {
  size_t size = 0;
  if (frame.stream_id != 0 &&
      !AddVarintFieldSize(
          kServiceFrameStreamIdField,
          SignedVarintValue(frame.stream_id),
          size)) {
    return false;
  }

  size_t payloadSize = 0;
  uint32_t fieldNumber = 0;
  switch (frame.kind) {
    case ServiceFrameKind::Request:
      if (!ComputeApplicationRequestSize(frame.request, payloadSize)) {
        return false;
      }
      fieldNumber = kServiceFrameRequestField;
      break;
    case ServiceFrameKind::Response:
      if (!ComputeApplicationResponseSize(frame.response, payloadSize)) {
        return false;
      }
      fieldNumber = kServiceFrameResponseField;
      break;
    case ServiceFrameKind::BodyChunk:
      if (!ComputeBodyChunkSize(frame.body_chunk, payloadSize)) {
        return false;
      }
      fieldNumber = kServiceFrameBodyChunkField;
      break;
    case ServiceFrameKind::Reset:
      if (!ComputeResetSize(frame.reset, payloadSize)) {
        return false;
      }
      fieldNumber = kServiceFrameResetField;
      break;
    case ServiceFrameKind::None:
      out = size;
      return true;
  }

  if (!AddDelimitedFieldSize(fieldNumber, payloadSize, size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeServiceRequestEnvelopeSize(
    ServiceType service,
    size_t payloadSize,
    size_t& out) noexcept {
  size_t size = 0;
  if (service != ServiceType::Daemon &&
      !AddVarintFieldSize(
          kServiceRequestServiceField,
          static_cast<uint64_t>(static_cast<int32_t>(service)),
          size)) {
    return false;
  }
  if (payloadSize != 0 &&
      !AddDelimitedFieldSize(kServiceRequestPayloadField, payloadSize, size)) {
    return false;
  }
  out = size;
  return true;
}

[[nodiscard]] bool ComputeServiceResponseEnvelopeSize(
    size_t payloadSize,
    size_t& out) noexcept {
  size_t size = 0;
  if (payloadSize != 0 &&
      !AddDelimitedFieldSize(kServiceResponsePayloadField, payloadSize, size)) {
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
  return WriteVarint(writer, Key(fieldNumber, wireType));
}

[[nodiscard]] Status WriteVarintField(
    BufferWriter& writer,
    uint32_t fieldNumber,
    uint64_t value) noexcept {
  Status status = WriteKey(writer, fieldNumber, kWireTypeVarint);
  if (!status.ok()) {
    return status;
  }
  return WriteVarint(writer, value);
}

[[nodiscard]] Status WriteDelimitedPrefix(
    BufferWriter& writer,
    uint32_t fieldNumber,
    size_t payloadSize) noexcept {
  Status status = WriteKey(writer, fieldNumber, kWireTypeDelimited);
  if (!status.ok()) {
    return status;
  }
  return WriteVarint(writer, payloadSize);
}

[[nodiscard]] Status WriteDelimitedField(
    BufferWriter& writer,
    uint32_t fieldNumber,
    ConstByteSpan payload) noexcept {
  Status status = WriteDelimitedPrefix(writer, fieldNumber, payload.size());
  if (!status.ok()) {
    return status;
  }
  return writer.Append(payload);
}

[[nodiscard]] Status WriteStringField(
    BufferWriter& writer,
    uint32_t fieldNumber,
    StringView value) noexcept {
  if (value.empty()) {
    return OkStatus();
  }
  return WriteDelimitedField(writer, fieldNumber, StringBytes(value));
}

[[nodiscard]] Status WriteBytesField(
    BufferWriter& writer,
    uint32_t fieldNumber,
    ConstByteSpan value) noexcept {
  if (value.empty()) {
    return OkStatus();
  }
  return WriteDelimitedField(writer, fieldNumber, value);
}

[[nodiscard]] Status WriteBoolField(
    BufferWriter& writer,
    uint32_t fieldNumber,
    bool value) noexcept {
  if (!value) {
    return OkStatus();
  }
  return WriteVarintField(writer, fieldNumber, 1);
}

[[nodiscard]] Status WriteHeader(
    BufferWriter& writer,
    HeaderView header) noexcept {
  Status status = WriteStringField(writer, kHeaderKeyField, header.key);
  if (!status.ok()) {
    return status;
  }
  return WriteStringField(writer, kHeaderValueField, header.value);
}

[[nodiscard]] Status WriteApplicationRequest(
    BufferWriter& writer,
    ApplicationRequestView request) noexcept {
  Status status =
      WriteStringField(writer, kApplicationRequestVerbField, request.verb);
  if (!status.ok()) {
    return status;
  }
  status = WriteStringField(writer, kApplicationRequestPathField, request.path);
  if (!status.ok()) {
    return status;
  }
  for (size_t i = 0; i < request.headers.size(); ++i) {
    size_t headerSize = 0;
    if (!ComputeHeaderSize(request.headers[i], headerSize)) {
      return Status::ResourceExhausted();
    }
    status = WriteDelimitedPrefix(
        writer, kApplicationRequestHeadersField, headerSize);
    if (!status.ok()) {
      return status;
    }
    status = WriteHeader(writer, request.headers[i]);
    if (!status.ok()) {
      return status;
    }
  }
  status = WriteBytesField(writer, kApplicationRequestBodyField, request.body);
  if (!status.ok()) {
    return status;
  }
  return WriteBoolField(
      writer, kApplicationRequestEndBodyField, request.end_body);
}

[[nodiscard]] Status WriteApplicationResponse(
    BufferWriter& writer,
    ApplicationResponseView response) noexcept {
  if (response.status != 0) {
    Status status = WriteVarintField(
        writer,
        kApplicationResponseStatusField,
        SignedVarintValue(response.status));
    if (!status.ok()) {
      return status;
    }
  }
  for (size_t i = 0; i < response.headers.size(); ++i) {
    size_t headerSize = 0;
    if (!ComputeHeaderSize(response.headers[i], headerSize)) {
      return Status::ResourceExhausted();
    }
    Status status = WriteDelimitedPrefix(
        writer, kApplicationResponseHeadersField, headerSize);
    if (!status.ok()) {
      return status;
    }
    status = WriteHeader(writer, response.headers[i]);
    if (!status.ok()) {
      return status;
    }
  }
  Status status =
      WriteBytesField(writer, kApplicationResponseBodyField, response.body);
  if (!status.ok()) {
    return status;
  }
  return WriteBoolField(
      writer, kApplicationResponseEndBodyField, response.end_body);
}

[[nodiscard]] Status WriteBodyChunk(
    BufferWriter& writer,
    BodyChunkView chunk) noexcept {
  Status status = WriteBytesField(writer, kBodyChunkDataField, chunk.data);
  if (!status.ok()) {
    return status;
  }
  return WriteBoolField(writer, kBodyChunkEndBodyField, chunk.end_body);
}

[[nodiscard]] Status WriteReset(
    BufferWriter& writer,
    ResetView reset) noexcept {
  if (reset.code != ResetCode::Unspecified) {
    Status status = WriteVarintField(
        writer,
        kResetCodeField,
        SignedVarintValue(static_cast<int32_t>(reset.code)));
    if (!status.ok()) {
      return status;
    }
  }
  return WriteStringField(writer, kResetReasonField, reset.reason);
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

[[nodiscard]] ServiceCodecResult ReadDelimited(
    Cursor& cursor,
    ConstByteSpan& out) noexcept {
  uint64_t len = 0;
  Status status = ReadVarint(cursor, len);
  if (!status.ok()) {
    return Failure(status, ServiceCodecError::MalformedVarint);
  }
  if (len > cursor.bytes.size() - cursor.offset) {
    return Failure(Status::DataLoss(), ServiceCodecError::LengthOutOfRange);
  }
  out = ConstByteSpan(
      cursor.bytes.data() + cursor.offset, static_cast<size_t>(len));
  cursor.offset += static_cast<size_t>(len);
  return {};
}

[[nodiscard]] ServiceCodecResult SkipField(
    Cursor& cursor,
    uint8_t wireType) noexcept {
  switch (wireType) {
    case kWireTypeVarint: {
      uint64_t ignored = 0;
      Status status = ReadVarint(cursor, ignored);
      if (!status.ok()) {
        return Failure(status, ServiceCodecError::MalformedVarint);
      }
      return {};
    }
    case kWireTypeFixed64:
      if (cursor.bytes.size() - cursor.offset < 8) {
        return Failure(Status::DataLoss(), ServiceCodecError::LengthOutOfRange);
      }
      cursor.offset += 8;
      return {};
    case kWireTypeDelimited: {
      ConstByteSpan ignored;
      return ReadDelimited(cursor, ignored);
    }
    case kWireTypeFixed32:
      if (cursor.bytes.size() - cursor.offset < 4) {
        return Failure(Status::DataLoss(), ServiceCodecError::LengthOutOfRange);
      }
      cursor.offset += 4;
      return {};
    default:
      return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
  }
}

[[nodiscard]] ServiceCodecResult
ReadKey(Cursor& cursor, uint64_t& fieldNumber, uint8_t& wireType) noexcept {
  uint64_t key = 0;
  Status status = ReadVarint(cursor, key);
  if (!status.ok()) {
    return Failure(status, ServiceCodecError::MalformedVarint);
  }
  wireType = static_cast<uint8_t>(key & 0x07);
  fieldNumber = key >> 3;
  if (!IsValidFieldNumber(fieldNumber) || !IsValidWireType(wireType)) {
    return Failure(Status::DataLoss(), ServiceCodecError::InvalidFieldKey);
  }
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeHeader(
    ConstByteSpan bytes,
    HeaderView& out) noexcept {
  Cursor cursor{bytes, 0};
  HeaderView decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kHeaderKeyField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan key;
        result = ReadDelimited(cursor, key);
        if (!result.ok()) {
          return result;
        }
        decoded.key = StringFromBytes(key);
        break;
      }
      case kHeaderValueField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan value;
        result = ReadDelimited(cursor, value);
        if (!result.ok()) {
          return result;
        }
        decoded.value = StringFromBytes(value);
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult StoreHeader(
    HeaderView header,
    Span<HeaderView> headerStorage,
    bool requireHeaderStorage,
    size_t& headerCount,
    bool& headerStorageTooSmall) noexcept {
  if (headerCount < headerStorage.size()) {
    headerStorage[headerCount] = header;
  } else if (requireHeaderStorage) {
    headerStorageTooSmall = true;
  }
  ++headerCount;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeApplicationRequest(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    bool requireHeaderStorage,
    ApplicationRequestView& out) noexcept {
  Cursor cursor{bytes, 0};
  ApplicationRequestView decoded;
  size_t headerCount = 0;
  bool headerStorageTooSmall = false;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kApplicationRequestVerbField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan verb;
        result = ReadDelimited(cursor, verb);
        if (!result.ok()) {
          return result;
        }
        decoded.verb = StringFromBytes(verb);
        break;
      }
      case kApplicationRequestPathField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan path;
        result = ReadDelimited(cursor, path);
        if (!result.ok()) {
          return result;
        }
        decoded.path = StringFromBytes(path);
        break;
      }
      case kApplicationRequestHeadersField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan headerBytes;
        result = ReadDelimited(cursor, headerBytes);
        if (!result.ok()) {
          return result;
        }
        HeaderView header;
        result = DecodeHeader(headerBytes, header);
        if (!result.ok()) {
          return result;
        }
        result = StoreHeader(
            header,
            headerStorage,
            requireHeaderStorage,
            headerCount,
            headerStorageTooSmall);
        if (!result.ok()) {
          return result;
        }
        break;
      }
      case kApplicationRequestBodyField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.body);
        if (!result.ok()) {
          return result;
        }
        break;
      }
      case kApplicationRequestEndBodyField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.end_body = value != 0;
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  if (headerStorageTooSmall) {
    return Failure(
        Status::ResourceExhausted(),
        ServiceCodecError::HeaderStorageTooSmall,
        headerCount);
  }
  const size_t storedHeaderCount =
      headerCount < headerStorage.size() ? headerCount : headerStorage.size();
  decoded.headers = HeaderViewSpan(headerStorage, storedHeaderCount);
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeApplicationResponse(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    bool requireHeaderStorage,
    ApplicationResponseView& out) noexcept {
  Cursor cursor{bytes, 0};
  ApplicationResponseView decoded;
  size_t headerCount = 0;
  bool headerStorageTooSmall = false;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kApplicationResponseStatusField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.status = static_cast<int32_t>(value);
        break;
      }
      case kApplicationResponseHeadersField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan headerBytes;
        result = ReadDelimited(cursor, headerBytes);
        if (!result.ok()) {
          return result;
        }
        HeaderView header;
        result = DecodeHeader(headerBytes, header);
        if (!result.ok()) {
          return result;
        }
        result = StoreHeader(
            header,
            headerStorage,
            requireHeaderStorage,
            headerCount,
            headerStorageTooSmall);
        if (!result.ok()) {
          return result;
        }
        break;
      }
      case kApplicationResponseBodyField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.body);
        if (!result.ok()) {
          return result;
        }
        break;
      }
      case kApplicationResponseEndBodyField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.end_body = value != 0;
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  if (headerStorageTooSmall) {
    return Failure(
        Status::ResourceExhausted(),
        ServiceCodecError::HeaderStorageTooSmall,
        headerCount);
  }
  const size_t storedHeaderCount =
      headerCount < headerStorage.size() ? headerCount : headerStorage.size();
  decoded.headers = HeaderViewSpan(headerStorage, storedHeaderCount);
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeBodyChunk(
    ConstByteSpan bytes,
    BodyChunkView& out) noexcept {
  Cursor cursor{bytes, 0};
  BodyChunkView decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kBodyChunkDataField:
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.data);
        if (!result.ok()) {
          return result;
        }
        break;
      case kBodyChunkEndBodyField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.end_body = value != 0;
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeReset(
    ConstByteSpan bytes,
    ResetView& out) noexcept {
  Cursor cursor{bytes, 0};
  ResetView decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kResetCodeField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.code = static_cast<ResetCode>(static_cast<int32_t>(value));
        break;
      }
      case kResetReasonField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        ConstByteSpan reason;
        result = ReadDelimited(cursor, reason);
        if (!result.ok()) {
          return result;
        }
        decoded.reason = StringFromBytes(reason);
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeServiceFrameTop(
    ConstByteSpan bytes,
    TopLevelServiceFrame& out) noexcept {
  if (!IsValidInput(bytes)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::InvalidFieldKey);
  }

  Cursor cursor{bytes, 0};
  TopLevelServiceFrame decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kServiceFrameStreamIdField: {
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        uint64_t value = 0;
        Status status = ReadVarint(cursor, value);
        if (!status.ok()) {
          return Failure(status, ServiceCodecError::MalformedVarint);
        }
        decoded.stream_id = static_cast<int64_t>(value);
        break;
      }
      case kServiceFrameRequestField:
      case kServiceFrameResponseField:
      case kServiceFrameBodyChunkField:
      case kServiceFrameResetField: {
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.payload);
        if (!result.ok()) {
          return result;
        }
        switch (fieldNumber) {
          case kServiceFrameRequestField:
            decoded.kind = ServiceFrameKind::Request;
            break;
          case kServiceFrameResponseField:
            decoded.kind = ServiceFrameKind::Response;
            break;
          case kServiceFrameBodyChunkField:
            decoded.kind = ServiceFrameKind::BodyChunk;
            break;
          case kServiceFrameResetField:
            decoded.kind = ServiceFrameKind::Reset;
            break;
        }
        break;
      }
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }

  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeServiceFramePayload(
    TopLevelServiceFrame top,
    Span<HeaderView> headerStorage,
    bool requireHeaderStorage,
    DecodedServiceFrame& out) noexcept {
  DecodedServiceFrame decoded;
  decoded.stream_id = top.stream_id;
  decoded.kind = top.kind;

  ServiceCodecResult result;
  switch (top.kind) {
    case ServiceFrameKind::Request:
      result = DecodeApplicationRequest(
          top.payload, headerStorage, requireHeaderStorage, decoded.request);
      break;
    case ServiceFrameKind::Response:
      result = DecodeApplicationResponse(
          top.payload, headerStorage, requireHeaderStorage, decoded.response);
      break;
    case ServiceFrameKind::BodyChunk:
      result = DecodeBodyChunk(top.payload, decoded.body_chunk);
      break;
    case ServiceFrameKind::Reset:
      result = DecodeReset(top.payload, decoded.reset);
      break;
    case ServiceFrameKind::None:
      return Failure(
          Status::InvalidArgument(),
          ServiceCodecError::UnknownServiceFrameKind);
  }
  if (!result.ok()) {
    return result;
  }
  out = decoded;
  return {};
}

[[nodiscard]] ServiceCodecResult DecodeServiceFrameInternal(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    bool requireHeaderStorage,
    DecodedServiceFrame& out) noexcept {
  if (!IsValidHeaderStorage(headerStorage)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::InvalidFieldKey);
  }
  TopLevelServiceFrame top;
  ServiceCodecResult result = DecodeServiceFrameTop(bytes, top);
  if (!result.ok()) {
    return result;
  }
  return DecodeServiceFramePayload(
      top, headerStorage, requireHeaderStorage, out);
}

[[nodiscard]] bool ValidateApplicationRequest(
    ApplicationRequestView request) noexcept {
  return !request.path.empty() && request.path.front() == '/';
}

[[nodiscard]] Status ValidateFrameForEncode(ServiceFrameView frame) noexcept {
  if (!IsValidHeaders(frame.request.headers) ||
      !IsValidHeaders(frame.response.headers) ||
      !IsValidInput(frame.request.body) || !IsValidInput(frame.response.body) ||
      !IsValidInput(frame.body_chunk.data) ||
      !IsValidString(frame.request.verb) ||
      !IsValidString(frame.request.path) ||
      !IsValidString(frame.reset.reason)) {
    return Status::InvalidArgument();
  }

  switch (frame.kind) {
    case ServiceFrameKind::Request:
      if (frame.stream_id == kReservedStreamId ||
          !ValidateApplicationRequest(frame.request)) {
        return Status::InvalidArgument();
      }
      return OkStatus();
    case ServiceFrameKind::Response:
    case ServiceFrameKind::BodyChunk:
    case ServiceFrameKind::Reset:
      return frame.stream_id == kReservedStreamId ? Status::InvalidArgument()
                                                  : OkStatus();
    case ServiceFrameKind::None:
      return Status::InvalidArgument();
  }
  return Status::InvalidArgument();
}

} // namespace

StringView ResetCodeName(ResetCode code) noexcept {
  switch (code) {
    case ResetCode::Unspecified:
      return "CODE_UNSPECIFIED";
    case ResetCode::Cancelled:
      return "CANCELLED";
    case ResetCode::Timeout:
      return "TIMEOUT";
    case ResetCode::ProtocolError:
      return "PROTOCOL_ERROR";
    case ResetCode::RefusedStream:
      return "REFUSED_STREAM";
    case ResetCode::InternalError:
      return "INTERNAL_ERROR";
    case ResetCode::ServiceUnavailable:
      return "SERVICE_UNAVAILABLE";
  }
  return StringView();
}

size_t ServiceRequestEnvelopeSize(
    ServiceType service,
    size_t payloadSize) noexcept {
  if (!IsKnownServiceType(service)) {
    return 0;
  }
  size_t size = 0;
  if (!ComputeServiceRequestEnvelopeSize(service, payloadSize, size)) {
    return 0;
  }
  return size;
}

size_t ServiceResponseEnvelopeSize(size_t payloadSize) noexcept {
  size_t size = 0;
  if (!ComputeServiceResponseEnvelopeSize(payloadSize, size)) {
    return 0;
  }
  return size;
}

StatusWithSize EncodeServiceRequestEnvelope(
    ServiceType service,
    ConstByteSpan payload,
    ByteSpan out) noexcept {
  if (!IsKnownServiceType(service) || !IsValidInput(payload) ||
      !IsValidOutput(out)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  size_t encodedSize = 0;
  if (!ComputeServiceRequestEnvelopeSize(
          service, payload.size(), encodedSize)) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  Status status = ValidateOutputAtLeast(out, encodedSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  BufferWriter writer(out.subspan(0, encodedSize));
  if (service != ServiceType::Daemon) {
    status = WriteVarintField(
        writer,
        kServiceRequestServiceField,
        static_cast<uint64_t>(static_cast<int32_t>(service)));
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }
  if (!payload.empty()) {
    status = WriteDelimitedField(writer, kServiceRequestPayloadField, payload);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }
  return StatusWithSize(writer.status(), writer.written());
}

StatusWithSize EncodeServiceResponseEnvelope(
    ConstByteSpan payload,
    ByteSpan out) noexcept {
  if (!IsValidInput(payload) || !IsValidOutput(out)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  size_t encodedSize = 0;
  if (!ComputeServiceResponseEnvelopeSize(payload.size(), encodedSize)) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  Status status = ValidateOutputAtLeast(out, encodedSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  BufferWriter writer(out.subspan(0, encodedSize));
  if (!payload.empty()) {
    status = WriteDelimitedField(writer, kServiceResponsePayloadField, payload);
    if (!status.ok()) {
      return StatusWithSize(status, writer.written());
    }
  }
  return StatusWithSize(writer.status(), writer.written());
}

size_t EncodedServiceFrameSize(ServiceFrameView frame) noexcept {
  size_t size = 0;
  if (!ComputeServiceFrameSize(frame, size)) {
    return 0;
  }
  return size;
}

StatusWithSize EncodeServiceFrame(
    ServiceFrameView frame,
    ByteSpan out) noexcept {
  Status status = ValidateFrameForEncode(frame);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }
  if (!IsValidOutput(out)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  size_t encodedSize = 0;
  if (!ComputeServiceFrameSize(frame, encodedSize)) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }
  status = ValidateOutputAtLeast(out, encodedSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  BufferWriter writer(out.subspan(0, encodedSize));
  status = WriteVarintField(
      writer, kServiceFrameStreamIdField, SignedVarintValue(frame.stream_id));
  if (!status.ok()) {
    return StatusWithSize(status, writer.written());
  }

  size_t payloadSize = 0;
  switch (frame.kind) {
    case ServiceFrameKind::Request:
      if (!ComputeApplicationRequestSize(frame.request, payloadSize)) {
        return StatusWithSize(Status::ResourceExhausted(), writer.written());
      }
      status =
          WriteDelimitedPrefix(writer, kServiceFrameRequestField, payloadSize);
      if (!status.ok()) {
        return StatusWithSize(status, writer.written());
      }
      status = WriteApplicationRequest(writer, frame.request);
      break;
    case ServiceFrameKind::Response:
      if (!ComputeApplicationResponseSize(frame.response, payloadSize)) {
        return StatusWithSize(Status::ResourceExhausted(), writer.written());
      }
      status =
          WriteDelimitedPrefix(writer, kServiceFrameResponseField, payloadSize);
      if (!status.ok()) {
        return StatusWithSize(status, writer.written());
      }
      status = WriteApplicationResponse(writer, frame.response);
      break;
    case ServiceFrameKind::BodyChunk:
      if (!ComputeBodyChunkSize(frame.body_chunk, payloadSize)) {
        return StatusWithSize(Status::ResourceExhausted(), writer.written());
      }
      status = WriteDelimitedPrefix(
          writer, kServiceFrameBodyChunkField, payloadSize);
      if (!status.ok()) {
        return StatusWithSize(status, writer.written());
      }
      status = WriteBodyChunk(writer, frame.body_chunk);
      break;
    case ServiceFrameKind::Reset:
      if (!ComputeResetSize(frame.reset, payloadSize)) {
        return StatusWithSize(Status::ResourceExhausted(), writer.written());
      }
      status =
          WriteDelimitedPrefix(writer, kServiceFrameResetField, payloadSize);
      if (!status.ok()) {
        return StatusWithSize(status, writer.written());
      }
      status = WriteReset(writer, frame.reset);
      break;
    case ServiceFrameKind::None:
      status = Status::InvalidArgument();
      break;
  }

  if (!status.ok()) {
    return StatusWithSize(status, writer.written());
  }
  return StatusWithSize(writer.status(), writer.written());
}

StatusWithSize EncodeApplicationRequestFrame(
    int64_t streamId,
    ApplicationRequestView request,
    ByteSpan out) noexcept {
  return EncodeServiceFrame(
      ServiceFrameView{
          streamId, ServiceFrameKind::Request, request, {}, {}, {}},
      out);
}

StatusWithSize EncodeBodyChunkFrame(
    int64_t streamId,
    BodyChunkView chunk,
    ByteSpan out) noexcept {
  return EncodeServiceFrame(
      ServiceFrameView{
          streamId, ServiceFrameKind::BodyChunk, {}, {}, chunk, {}},
      out);
}

StatusWithSize EncodeBodyChunkRequestPrefix(
    ServiceType service,
    int64_t streamId,
    size_t dataSize,
    ByteSpan out) noexcept {
  if (!IsKnownServiceType(service) || streamId == kReservedStreamId ||
      dataSize == 0 || !IsValidOutput(out)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  // Sizes as ComputeBodyChunkSize, ComputeServiceFrameSize and
  // ComputeServiceRequestEnvelopeSize work them out for the same frame.
  size_t chunkSize = 0;
  size_t frameSize = 0;
  size_t envelopeSize = 0;
  if (!AddDelimitedFieldSize(kBodyChunkDataField, dataSize, chunkSize) ||
      (streamId != 0 &&
       !AddVarintFieldSize(
           kServiceFrameStreamIdField, SignedVarintValue(streamId), frameSize)) ||
      !AddDelimitedFieldSize(kServiceFrameBodyChunkField, chunkSize, frameSize) ||
      !ComputeServiceRequestEnvelopeSize(service, frameSize, envelopeSize) ||
      envelopeSize <= dataSize) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }
  const size_t prefixSize = envelopeSize - dataSize;
  Status status = ValidateOutputAtLeast(out, prefixSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  BufferWriter writer(out.subspan(0, prefixSize));
  if (service != ServiceType::Daemon) {
    status = WriteVarintField(
        writer,
        kServiceRequestServiceField,
        static_cast<uint64_t>(static_cast<int32_t>(service)));
  }
  if (status.ok()) {
    status = WriteDelimitedPrefix(writer, kServiceRequestPayloadField, frameSize);
  }
  if (status.ok() && streamId != 0) {
    status = WriteVarintField(
        writer, kServiceFrameStreamIdField, SignedVarintValue(streamId));
  }
  if (status.ok()) {
    status = WriteDelimitedPrefix(writer, kServiceFrameBodyChunkField, chunkSize);
  }
  if (status.ok()) {
    status = WriteDelimitedPrefix(writer, kBodyChunkDataField, dataSize);
  }
  if (!status.ok() || writer.written() != prefixSize) {
    return StatusWithSize(
        status.ok() ? Status::Internal() : status, writer.written());
  }
  return StatusWithSize(OkStatus(), prefixSize);
}

StatusWithSize
EncodeResetFrame(int64_t streamId, ResetView reset, ByteSpan out) noexcept {
  return EncodeServiceFrame(
      ServiceFrameView{streamId, ServiceFrameKind::Reset, {}, {}, {}, reset},
      out);
}

ServiceCodecResult DecodeServiceRequestEnvelopeDetailed(
    ConstByteSpan bytes,
    DecodedServiceRequestEnvelope& out) noexcept {
  if (!IsValidInput(bytes)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::InvalidFieldKey);
  }

  Cursor cursor{bytes, 0};
  uint64_t service = static_cast<uint64_t>(ServiceType::Daemon);
  DecodedServiceRequestEnvelope decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kServiceRequestServiceField:
        if (wireType != kWireTypeVarint) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        {
          Status status = ReadVarint(cursor, service);
          if (!status.ok()) {
            return Failure(status, ServiceCodecError::MalformedVarint);
          }
        }
        break;
      case kServiceRequestPayloadField:
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.payload);
        if (!result.ok()) {
          return result;
        }
        break;
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }

  if (!IsKnownServiceValue(service)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::UnknownEnvelopeService);
  }
  decoded.service = static_cast<ServiceType>(service);
  out = decoded;
  return {};
}

ServiceCodecResult DecodeServiceResponseEnvelopeDetailed(
    ConstByteSpan bytes,
    DecodedServiceResponseEnvelope& out) noexcept {
  if (!IsValidInput(bytes)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::InvalidFieldKey);
  }

  Cursor cursor{bytes, 0};
  DecodedServiceResponseEnvelope decoded;
  while (cursor.offset < cursor.bytes.size()) {
    uint64_t fieldNumber = 0;
    uint8_t wireType = 0;
    ServiceCodecResult result = ReadKey(cursor, fieldNumber, wireType);
    if (!result.ok()) {
      return result;
    }
    switch (fieldNumber) {
      case kServiceResponsePayloadField:
        if (wireType != kWireTypeDelimited) {
          return Failure(Status::DataLoss(), ServiceCodecError::WrongWireType);
        }
        result = ReadDelimited(cursor, decoded.payload);
        if (!result.ok()) {
          return result;
        }
        break;
      default:
        result = SkipField(cursor, wireType);
        if (!result.ok()) {
          return result;
        }
        break;
    }
  }
  out = decoded;
  return {};
}

ServiceCodecResult DecodeServiceFrameDetailed(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    DecodedServiceFrame& out) noexcept {
  return DecodeServiceFrameInternal(
      bytes, headerStorage, /*requireHeaderStorage=*/true, out);
}

ServiceCodecResult DecodeServerServiceFrameDetailed(
    ConstByteSpan bytes,
    Span<HeaderView> headerStorage,
    DecodedServiceFrame& out) noexcept {
  if (!IsValidHeaderStorage(headerStorage)) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::InvalidFieldKey);
  }
  TopLevelServiceFrame top;
  ServiceCodecResult result = DecodeServiceFrameTop(bytes, top);
  if (!result.ok()) {
    return result;
  }
  result = DecodeServiceFramePayload(
      top, headerStorage, top.kind != ServiceFrameKind::Request, out);
  if (!result.ok()) {
    return result;
  }
  if (out.kind == ServiceFrameKind::Request) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::UnexpectedRequestFrame);
  }
  return {};
}

ServiceCodecResult ValidateClientEnvelopeDetailed(
    ConstByteSpan bytes) noexcept {
  DecodedServiceRequestEnvelope envelope;
  ServiceCodecResult result =
      DecodeServiceRequestEnvelopeDetailed(bytes, envelope);
  if (!result.ok()) {
    return result;
  }
  if (envelope.payload.empty()) {
    return Failure(
        Status::InvalidArgument(), ServiceCodecError::EmptyEnvelopePayload);
  }

  DecodedServiceFrame frame;
  result = DecodeServiceFrameInternal(
      envelope.payload,
      Span<HeaderView>(),
      /*requireHeaderStorage=*/false,
      frame);
  if (!result.ok()) {
    return result;
  }

  switch (frame.kind) {
    case ServiceFrameKind::Request:
      if (frame.stream_id == kReservedStreamId) {
        return Failure(
            Status::InvalidArgument(), ServiceCodecError::StreamIdReserved);
      }
      if (!ValidateApplicationRequest(frame.request)) {
        return Failure(
            Status::InvalidArgument(), ServiceCodecError::RequestPathInvalid);
      }
      return {};
    case ServiceFrameKind::BodyChunk:
    case ServiceFrameKind::Reset:
      return frame.stream_id == kReservedStreamId
          ? Failure(
                Status::InvalidArgument(), ServiceCodecError::StreamIdReserved)
          : ServiceCodecResult{};
    case ServiceFrameKind::Response:
      return Failure(
          Status::InvalidArgument(), ServiceCodecError::InvalidClientFrameKind);
    case ServiceFrameKind::None:
      return Failure(
          Status::InvalidArgument(),
          ServiceCodecError::UnknownServiceFrameKind);
  }
  return Failure(
      Status::InvalidArgument(), ServiceCodecError::UnknownServiceFrameKind);
}

Status ValidateClientEnvelope(ConstByteSpan bytes) noexcept {
  return ValidateClientEnvelopeDetailed(bytes).status;
}

} // namespace musegadgets::noise::core
