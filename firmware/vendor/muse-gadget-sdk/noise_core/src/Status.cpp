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

#include <xplat/noise/core/Status.h>

namespace musegadgets::noise::core {

const char* StatusCodeToString(StatusCode code) noexcept {
  switch (code) {
    case StatusCode::OK:
      return "OK";
    case StatusCode::INVALID_ARGUMENT:
      return "INVALID_ARGUMENT";
    case StatusCode::RESOURCE_EXHAUSTED:
      return "RESOURCE_EXHAUSTED";
    case StatusCode::FAILED_PRECONDITION:
      return "FAILED_PRECONDITION";
    case StatusCode::OUT_OF_RANGE:
      return "OUT_OF_RANGE";
    case StatusCode::INTERNAL:
      return "INTERNAL";
    case StatusCode::UNAVAILABLE:
      return "UNAVAILABLE";
    case StatusCode::DATA_LOSS:
      return "DATA_LOSS";
    case StatusCode::UNAUTHENTICATED:
      return "UNAUTHENTICATED";
  }
  return "INVALID_STATUS";
}

const char* Status::str() const noexcept {
  return StatusCodeToString(code_);
}

} // namespace musegadgets::noise::core
