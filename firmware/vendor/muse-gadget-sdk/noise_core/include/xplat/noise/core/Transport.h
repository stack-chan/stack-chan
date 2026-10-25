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
#include <xplat/noise/core/Secret.h>
#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>

namespace musegadgets::noise::core {

// Exception-free post-handshake transport for
// `Noise_XX_25519_AESGCM_SHA256`.
//
// The wire layout is `ciphertext || 16-byte tag` with empty associated data.
// Caller-owned buffers carry all input/output storage; this type owns only
// per-direction keys, counters, and fail-closed state. Callers serialize
// access.
class Transport {
 public:
  static constexpr size_t kKeySize = CryptoBackend::kAes256GcmKeySize;
  static constexpr size_t kNonceSize = CryptoBackend::kAes256GcmNonceSize;
  static constexpr size_t kTagSize = CryptoBackend::kAes256GcmTagSize;

  Transport(
      CryptoBackend& backend,
      ConstByteSpan sendKey32,
      ConstByteSpan recvKey32) noexcept;
  ~Transport() noexcept;

  Transport(const Transport&) = delete;
  Transport& operator=(const Transport&) = delete;
  Transport(Transport&&) = delete;
  Transport& operator=(Transport&&) = delete;

  [[nodiscard]] Status status() const noexcept {
    return initStatus_;
  }

  [[nodiscard]] StatusWithSize Seal(
      ConstByteSpan plaintext,
      ByteSpan ciphertextAndTagOut) noexcept;

  [[nodiscard]] StatusWithSize SealInPlace(
      ByteSpan plaintextAndCiphertext,
      size_t plaintextLen) noexcept;

  [[nodiscard]] StatusWithSize Open(
      ConstByteSpan ciphertextAndTag,
      ByteSpan plaintextOut) noexcept;

  struct ReceiveStateSnapshot {
    uint64_t recv_nonce{0};
    bool receive_poisoned{false};
  };

  [[nodiscard]] ReceiveStateSnapshot SnapshotReceiveState() const noexcept;

  void RestoreReceiveState(ReceiveStateSnapshot snapshot) noexcept;

  [[nodiscard]] uint64_t sendNonce() const noexcept {
    return sendNonce_;
  }

  [[nodiscard]] uint64_t recvNonce() const noexcept {
    return recvNonce_;
  }

  [[nodiscard]] bool isReceivePoisoned() const noexcept {
    return receivePoisoned_;
  }

#if defined(NOISE_BUILDING_TESTS)
  void setSendNonceForTesting(uint64_t nonce) noexcept {
    sendNonce_ = nonce;
    if (initStatus_.ok()) {
      sendExhausted_ = false;
    }
  }

  void setRecvNonceForTesting(uint64_t nonce) noexcept {
    recvNonce_ = nonce;
    if (initStatus_.ok()) {
      receivePoisoned_ = false;
    }
  }
#endif // NOISE_BUILDING_TESTS

 private:
  void FailClosed(Status status) noexcept;
  void DestroySecrets() noexcept;

  CryptoBackend& backend_;
  SecretArray<kKeySize> sendKey_;
  SecretArray<kKeySize> recvKey_;
  uint64_t sendNonce_{0};
  uint64_t recvNonce_{0};
  bool sendExhausted_{false};
  bool receivePoisoned_{false};
  Status initStatus_{OkStatus()};
};

} // namespace musegadgets::noise::core
