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

#include <xplat/noise/core/CryptoBackend.h>
#include <xplat/noise/core/Secret.h>
#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>

namespace musegadgets::noise::core {

// Exception-free initiator-side core for `Noise_XX_25519_AESGCM_SHA256`.
//
// Wire layout:
//   msg1 (->): e_pub_i                                      (32 bytes)
//   msg2 (<-): e_pub_r || s_ct(48) || payload_ct(N + 16)    (96 + N bytes)
//   msg3 (->): s_ct(48) || payload_ct(M + 16)               (64 + M bytes)
class InitiatorHandshake {
 public:
  static constexpr size_t kKeySize = CryptoBackend::kX25519KeySize;
  static constexpr size_t kMessage1Size = kKeySize;
  static constexpr size_t kStaticCiphertextSize =
      kKeySize + CryptoBackend::kAes256GcmTagSize;
  static constexpr size_t kMinMessage2Size =
      kKeySize + kStaticCiphertextSize + CryptoBackend::kAes256GcmTagSize;
  static constexpr size_t kMinMessage3Size =
      kStaticCiphertextSize + CryptoBackend::kAes256GcmTagSize;
  static constexpr size_t kMaxMessageSize = 64u * 1024u;
  static constexpr size_t kMaxMessage3PayloadSize =
      kMaxMessageSize - kMinMessage3Size;

  explicit InitiatorHandshake(CryptoBackend& backend) noexcept;
  ~InitiatorHandshake() noexcept;

  InitiatorHandshake(const InitiatorHandshake&) = delete;
  InitiatorHandshake& operator=(const InitiatorHandshake&) = delete;
  InitiatorHandshake(InitiatorHandshake&&) = delete;
  InitiatorHandshake& operator=(InitiatorHandshake&&) = delete;

  [[nodiscard]] StatusWithSize WriteMessage1(ByteSpan out) noexcept;

  [[nodiscard]] Status ReadMessage2(
      ConstByteSpan msg2,
      ByteSpan peerExtraOut,
      size_t& peerExtraWritten) noexcept;

  [[nodiscard]] StatusWithSize WriteMessage3(
      ConstByteSpan initiatorPayload,
      ByteSpan out) noexcept;

  [[nodiscard]] Status Finalize(
      ByteSpan sendKey32,
      ByteSpan recvKey32) noexcept;

  [[nodiscard]] ConstByteSpan peerStaticPublicKey() const noexcept {
    return ConstByteSpan(peerStaticPublicKey_);
  }

  [[nodiscard]] ConstByteSpan handshakeHash() const noexcept {
    return ConstByteSpan(handshakeHash_);
  }

#if defined(NOISE_BUILDING_TESTS)
  [[nodiscard]] Status SetStaticKeypairForTesting(
      ConstByteSpan privateKey32,
      ConstByteSpan publicKey32) noexcept {
    return SetKeypairForTesting(
        privateKey32, publicKey32, staticPrivateKey_, staticPublicKey_, true);
  }

  [[nodiscard]] Status SetEphemeralKeypairForTesting(
      ConstByteSpan privateKey32,
      ConstByteSpan publicKey32) noexcept {
    return SetKeypairForTesting(
        privateKey32,
        publicKey32,
        ephemeralPrivateKey_,
        ephemeralPublicKey_,
        false);
  }

  [[nodiscard]] ConstByteSpan staticPublicKeyForTesting() const noexcept {
    return ConstByteSpan(staticPublicKey_);
  }
#endif // NOISE_BUILDING_TESTS

 private:
  enum class Stage : uint8_t {
    Init,
    WroteMessage1,
    ReadMessage2,
    WroteMessage3,
    Finalized,
    Poisoned,
  };

  [[nodiscard]] Status EnsureStaticKeypair() noexcept;
  [[nodiscard]] Status EnsureEphemeralKeypair() noexcept;
  [[nodiscard]] Status MixHash(ConstByteSpan data) noexcept;
  [[nodiscard]] Status MixKey(ConstByteSpan inputKeyMaterial) noexcept;
  [[nodiscard]] Status EncryptAndHash(
      ConstByteSpan plaintext,
      ByteSpan ciphertextOut) noexcept;
  [[nodiscard]] Status DecryptAndHash(
      ConstByteSpan ciphertext,
      ByteSpan plaintextOut) noexcept;
  [[nodiscard]] Status Split(ByteSpan key1Out, ByteSpan key2Out) noexcept;

  void InitializeSymmetric() noexcept;
  void DestroySecrets() noexcept;
  void Poison() noexcept;

#if defined(NOISE_BUILDING_TESTS)
  [[nodiscard]] Status SetKeypairForTesting(
      ConstByteSpan privateKey32,
      ConstByteSpan publicKey32,
      SecretArray<kKeySize>& privateKeyOut,
      std::array<uint8_t, kKeySize>& publicKeyOut,
      bool isStaticKeypair) noexcept {
    if (stage_ != Stage::Init) {
      return Status::FailedPrecondition();
    }
    if (privateKey32.size() != kKeySize || publicKey32.size() != kKeySize ||
        (privateKey32.data() == nullptr && !privateKey32.empty()) ||
        (publicKey32.data() == nullptr && !publicKey32.empty())) {
      return Status::InvalidArgument();
    }

    std::array<uint8_t, kKeySize> recomputed{};
    Status status =
        backend_.X25519PublicFromPrivate(privateKey32, ByteSpan(recomputed));
    if (!status.ok()) {
      return status;
    }
    for (size_t i = 0; i < kKeySize; ++i) {
      if (recomputed[i] != publicKey32[i]) {
        return Status::InvalidArgument();
      }
    }
    for (size_t i = 0; i < kKeySize; ++i) {
      privateKeyOut[i] = privateKey32[i];
      publicKeyOut[i] = publicKey32[i];
    }
    if (isStaticKeypair) {
      staticInjected_ = true;
    } else {
      ephemeralInjected_ = true;
    }
    return OkStatus();
  }
#endif // NOISE_BUILDING_TESTS

  CryptoBackend& backend_;
  SecretArray<kKeySize> staticPrivateKey_;
  std::array<uint8_t, kKeySize> staticPublicKey_{};
  SecretArray<kKeySize> ephemeralPrivateKey_;
  std::array<uint8_t, kKeySize> ephemeralPublicKey_{};
  std::array<uint8_t, kKeySize> remoteEphemeralPublicKey_{};
  std::array<uint8_t, kKeySize> peerStaticPublicKey_{};

  std::array<uint8_t, kKeySize> handshakeHash_{};
  SecretArray<kKeySize> chainingKey_;
  SecretArray<kKeySize> cipherKey_;
  uint64_t cipherNonce_{0};
  bool hasCipherKey_{false};

  bool staticInjected_{false};
  bool ephemeralInjected_{false};
  Stage stage_{Stage::Init};
};

} // namespace musegadgets::noise::core
