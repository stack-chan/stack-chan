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

namespace musegadgets::noise::core {

enum class StatusCode : uint8_t {
  OK = 0,
  INVALID_ARGUMENT = 3,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  OUT_OF_RANGE = 11,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
};

const char* StatusCodeToString(StatusCode code) noexcept;

class [[nodiscard]] Status {
 public:
  using Code = StatusCode;

  constexpr Status() noexcept = default;
  constexpr Status(const Status&) noexcept = default;
  constexpr Status(Status&&) noexcept = default;
  constexpr Status& operator=(const Status&) noexcept = default;
  constexpr Status& operator=(Status&&) noexcept = default;

  explicit constexpr Status(StatusCode code) noexcept : code_(code) {}

  [[nodiscard]] static constexpr Status Ok() noexcept {
    return Status(StatusCode::OK);
  }

  [[nodiscard]] static constexpr Status InvalidArgument() noexcept {
    return Status(StatusCode::INVALID_ARGUMENT);
  }

  [[nodiscard]] static constexpr Status ResourceExhausted() noexcept {
    return Status(StatusCode::RESOURCE_EXHAUSTED);
  }

  [[nodiscard]] static constexpr Status FailedPrecondition() noexcept {
    return Status(StatusCode::FAILED_PRECONDITION);
  }

  [[nodiscard]] static constexpr Status Internal() noexcept {
    return Status(StatusCode::INTERNAL);
  }

  [[nodiscard]] static constexpr Status Unauthenticated() noexcept {
    return Status(StatusCode::UNAUTHENTICATED);
  }

  [[nodiscard]] static constexpr Status OutOfRange() noexcept {
    return Status(StatusCode::OUT_OF_RANGE);
  }

  [[nodiscard]] static constexpr Status DataLoss() noexcept {
    return Status(StatusCode::DATA_LOSS);
  }

  [[nodiscard]] static constexpr Status Unavailable() noexcept {
    return Status(StatusCode::UNAVAILABLE);
  }

  [[nodiscard]] constexpr StatusCode code() const noexcept {
    return code_;
  }

  [[nodiscard]] constexpr bool ok() const noexcept {
    return code_ == StatusCode::OK;
  }

  [[nodiscard]] constexpr bool IsInvalidArgument() const noexcept {
    return code_ == StatusCode::INVALID_ARGUMENT;
  }

  [[nodiscard]] constexpr bool IsResourceExhausted() const noexcept {
    return code_ == StatusCode::RESOURCE_EXHAUSTED;
  }

  [[nodiscard]] constexpr bool IsFailedPrecondition() const noexcept {
    return code_ == StatusCode::FAILED_PRECONDITION;
  }

  [[nodiscard]] constexpr bool IsInternal() const noexcept {
    return code_ == StatusCode::INTERNAL;
  }

  [[nodiscard]] constexpr bool IsUnauthenticated() const noexcept {
    return code_ == StatusCode::UNAUTHENTICATED;
  }

  [[nodiscard]] constexpr bool IsOutOfRange() const noexcept {
    return code_ == StatusCode::OUT_OF_RANGE;
  }

  [[nodiscard]] constexpr bool IsDataLoss() const noexcept {
    return code_ == StatusCode::DATA_LOSS;
  }

  [[nodiscard]] constexpr bool IsUnavailable() const noexcept {
    return code_ == StatusCode::UNAVAILABLE;
  }

  constexpr void Update(Status other) noexcept {
    if (ok()) {
      code_ = other.code();
    }
  }

  constexpr void IgnoreError() const noexcept {}

  [[nodiscard]] const char* str() const noexcept;

 private:
  StatusCode code_{StatusCode::OK};
};

[[nodiscard]] constexpr Status OkStatus() noexcept {
  return Status::Ok();
}

constexpr bool operator==(Status lhs, Status rhs) noexcept {
  return lhs.code() == rhs.code();
}

constexpr bool operator!=(Status lhs, Status rhs) noexcept {
  return !(lhs == rhs);
}

class [[nodiscard]] StatusWithSize {
 public:
  constexpr StatusWithSize() noexcept = default;
  constexpr StatusWithSize(const StatusWithSize&) noexcept = default;
  constexpr StatusWithSize(StatusWithSize&&) noexcept = default;
  constexpr StatusWithSize& operator=(const StatusWithSize&) noexcept = default;
  constexpr StatusWithSize& operator=(StatusWithSize&&) noexcept = default;

  constexpr StatusWithSize(Status status, size_t size) noexcept
      : status_(status), size_(size) {}

  [[nodiscard]] constexpr Status status() const noexcept {
    return status_;
  }

  [[nodiscard]] constexpr size_t size() const noexcept {
    return size_;
  }

  [[nodiscard]] constexpr bool ok() const noexcept {
    return status_.ok();
  }

 private:
  Status status_;
  size_t size_{0};
};

} // namespace musegadgets::noise::core
