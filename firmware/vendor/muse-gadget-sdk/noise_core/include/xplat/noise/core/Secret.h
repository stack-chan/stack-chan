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

#include <array>
#include <cstddef>
#include <cstdint>

#include <xplat/noise/core/Span.h>

namespace musegadgets::noise::core {

inline void Zeroize(ByteSpan bytes) noexcept {
  volatile uint8_t* data = bytes.data();
  for (size_t i = 0; i < bytes.size(); ++i) {
    data[i] = 0;
  }
}

inline void Zeroize(uint8_t* data, size_t size) noexcept {
  Zeroize(ByteSpan(data, size));
}

template <size_t kSize>
class SecretArray {
 public:
  SecretArray() noexcept = default;

  ~SecretArray() noexcept {
    Zeroize(span());
  }

  SecretArray(const SecretArray&) = delete;
  SecretArray& operator=(const SecretArray&) = delete;

  SecretArray(SecretArray&& other) noexcept {
    copyFrom(other);
    Zeroize(other.span());
  }

  SecretArray& operator=(SecretArray&& other) noexcept {
    if (this != &other) {
      Zeroize(span());
      copyFrom(other);
      Zeroize(other.span());
    }
    return *this;
  }

  [[nodiscard]] uint8_t* data() noexcept {
    return bytes_.data();
  }

  [[nodiscard]] const uint8_t* data() const noexcept {
    return bytes_.data();
  }

  [[nodiscard]] static constexpr size_t size() noexcept {
    return kSize;
  }

  [[nodiscard]] ByteSpan span() noexcept {
    return ByteSpan(bytes_);
  }

  [[nodiscard]] ConstByteSpan span() const noexcept {
    return ConstByteSpan(bytes_);
  }

  [[nodiscard]] uint8_t& operator[](size_t index) noexcept {
    return bytes_[index];
  }

  [[nodiscard]] const uint8_t& operator[](size_t index) const noexcept {
    return bytes_[index];
  }

 private:
  void copyFrom(const SecretArray& other) noexcept {
    for (size_t i = 0; i < kSize; ++i) {
      bytes_[i] = other.bytes_[i];
    }
  }

  std::array<uint8_t, kSize> bytes_{};
};

} // namespace musegadgets::noise::core
