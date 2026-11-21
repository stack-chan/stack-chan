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

#include <xplat/noise/core/Span.h>
#include <xplat/noise/core/Status.h>

namespace musegadgets::noise::core {

class CryptoBackend {
 public:
  static constexpr size_t kX25519KeySize = 32;
  static constexpr size_t kSha256DigestSize = 32;
  static constexpr size_t kAes256GcmKeySize = 32;
  static constexpr size_t kAes256GcmNonceSize = 12;
  static constexpr size_t kAes256GcmTagSize = 16;
  static constexpr size_t kMaxHkdfSha256Outputs = 3;

  CryptoBackend() noexcept = default;
  virtual ~CryptoBackend() noexcept = default;

  virtual Status Random(ByteSpan out) noexcept = 0;

  virtual Status X25519GenerateKeypair(
      ByteSpan privateKey32,
      ByteSpan publicKey32) noexcept = 0;

  virtual Status X25519PublicFromPrivate(
      ConstByteSpan privateKey32,
      ByteSpan publicKey32) noexcept = 0;

  virtual Status X25519Dh(
      ConstByteSpan privateKey32,
      ConstByteSpan peerPublic32,
      ByteSpan sharedSecret32) noexcept = 0;

  virtual Status Sha256(ConstByteSpan data, ByteSpan digest32) noexcept = 0;

  virtual Status Sha256Concat(
      ConstByteSpan prefix,
      ConstByteSpan suffix,
      ByteSpan digest32) noexcept = 0;

  virtual Status HkdfSha256(
      ConstByteSpan salt,
      ConstByteSpan ikm,
      ConstByteSpan info,
      Span<ByteSpan> outputs) noexcept = 0;

  virtual Status Aes256GcmSeal(
      ConstByteSpan key32,
      ConstByteSpan nonce12,
      ConstByteSpan aad,
      ConstByteSpan plaintext,
      ByteSpan ciphertextAndTagOut) noexcept = 0;

  virtual Status Aes256GcmOpen(
      ConstByteSpan key32,
      ConstByteSpan nonce12,
      ConstByteSpan aad,
      ConstByteSpan ciphertextAndTag,
      ByteSpan plaintextOut) noexcept = 0;
};

} // namespace musegadgets::noise::core
