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

namespace musegadgets::noise::core {

class BufferWriter {
 public:
  explicit constexpr BufferWriter(ByteSpan buffer) noexcept : buffer_(buffer) {}
  constexpr BufferWriter(const BufferWriter&) noexcept = default;
  constexpr BufferWriter(BufferWriter&&) noexcept = default;
  constexpr BufferWriter& operator=(const BufferWriter&) noexcept = default;
  constexpr BufferWriter& operator=(BufferWriter&&) noexcept = default;

  [[nodiscard]] Status AppendByte(uint8_t byte) noexcept {
    if (!status_.ok()) {
      return status_;
    }
    if (written_ >= buffer_.size()) {
      return setResourceExhausted();
    }

    buffer_[written_] = byte;
    ++written_;
    return status_;
  }

  [[nodiscard]] Status Append(ConstByteSpan bytes) noexcept {
    return WriteAt(written_, bytes);
  }

  [[nodiscard]] Status WriteAt(size_t offset, ConstByteSpan bytes) noexcept {
    if (!status_.ok()) {
      return status_;
    }
    if (offset > buffer_.size() || bytes.size() > buffer_.size() - offset) {
      return setResourceExhausted();
    }

    for (size_t i = 0; i < bytes.size(); ++i) {
      buffer_[offset + i] = bytes[i];
    }

    const size_t end = offset + bytes.size();
    if (end > written_) {
      written_ = end;
    }
    return status_;
  }

  [[nodiscard]] constexpr size_t written() const noexcept {
    return written_;
  }

  [[nodiscard]] constexpr size_t remaining() const noexcept {
    return buffer_.size() - written_;
  }

  [[nodiscard]] constexpr Status status() const noexcept {
    return status_;
  }

 private:
  Status setResourceExhausted() noexcept {
    status_ = Status::ResourceExhausted();
    return status_;
  }

  ByteSpan buffer_;
  size_t written_{0};
  Status status_;
};

} // namespace musegadgets::noise::core
