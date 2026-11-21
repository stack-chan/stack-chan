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
#include <type_traits>

namespace musegadgets::noise::core {

template <typename T>
class Span {
 public:
  using element_type = T;
  using value_type = std::remove_cv_t<T>;
  using pointer = T*;
  using reference = T&;
  using size_type = size_t;

  static constexpr size_t npos = static_cast<size_t>(-1);

  constexpr Span() noexcept = default;
  constexpr Span(const Span&) noexcept = default;
  constexpr Span(Span&&) noexcept = default;
  constexpr Span& operator=(const Span&) noexcept = default;
  constexpr Span& operator=(Span&&) noexcept = default;

  constexpr Span(T* data, size_t size) noexcept : data_(data), size_(size) {}

  template <size_t kSize>
  constexpr Span(T (&array)[kSize]) noexcept : data_(array), size_(kSize) {}

  template <
      typename U,
      size_t kSize,
      typename = std::enable_if_t<std::is_convertible_v<U*, T*>>>
  constexpr Span(std::array<U, kSize>& array) noexcept
      : data_(array.data()), size_(array.size()) {}

  template <
      typename U,
      size_t kSize,
      typename = std::enable_if_t<std::is_convertible_v<const U*, T*>>>
  constexpr Span(const std::array<U, kSize>& array) noexcept
      : data_(array.data()), size_(array.size()) {}

  template <
      typename U,
      typename = std::enable_if_t<std::is_convertible_v<U*, T*>>>
  constexpr Span(const Span<U>& other) noexcept
      : data_(other.data()), size_(other.size()) {}

  [[nodiscard]] constexpr T* data() const noexcept {
    return data_;
  }

  [[nodiscard]] constexpr size_t size() const noexcept {
    return size_;
  }

  [[nodiscard]] constexpr bool empty() const noexcept {
    return size_ == 0;
  }

  [[nodiscard]] constexpr T& operator[](size_t index) const noexcept {
    return data_[index];
  }

  [[nodiscard]] constexpr Span subspan(size_t offset, size_t count = npos)
      const noexcept {
    if (offset > size_) {
      return Span(endData(), 0);
    }

    const size_t available = size_ - offset;
    const size_t spanSize =
        count == npos || count > available ? available : count;
    return Span(data_ == nullptr ? nullptr : data_ + offset, spanSize);
  }

 private:
  [[nodiscard]] constexpr T* endData() const noexcept {
    return data_ == nullptr ? nullptr : data_ + size_;
  }

  T* data_{nullptr};
  size_t size_{0};
};

using ByteSpan = Span<uint8_t>;
using ConstByteSpan = Span<const uint8_t>;

} // namespace musegadgets::noise::core
