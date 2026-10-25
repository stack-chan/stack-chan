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

#include <xplat/noise/core/Transport.h>

#include <array>
#include <cstdint>
#include <limits>

namespace musegadgets::noise::core {
namespace {

bool IsValidInput(ConstByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

bool HasExactInputSize(ConstByteSpan bytes, size_t expected) noexcept {
  return bytes.size() == expected && IsValidInput(bytes);
}

void CopyBytes(ConstByteSpan from, ByteSpan to) noexcept {
  for (size_t i = 0; i < from.size(); ++i) {
    to[i] = from[i];
  }
}

void ZeroizeIfValid(ByteSpan bytes) noexcept {
  if (IsValidOutput(bytes)) {
    Zeroize(bytes);
  }
}

Status ValidateOutputAtLeast(ByteSpan out, size_t required) noexcept {
  if (out.size() < required) {
    return Status::ResourceExhausted();
  }
  if (required != 0 && out.data() == nullptr) {
    return Status::InvalidArgument();
  }
  return OkStatus();
}

void FormatAesGcmNonce(
    uint64_t nonce,
    std::array<uint8_t, Transport::kNonceSize>& out) noexcept {
  static_assert(Transport::kNonceSize == 12);
  out.fill(0);
  out[4] = static_cast<uint8_t>((nonce >> 56) & 0xff);
  out[5] = static_cast<uint8_t>((nonce >> 48) & 0xff);
  out[6] = static_cast<uint8_t>((nonce >> 40) & 0xff);
  out[7] = static_cast<uint8_t>((nonce >> 32) & 0xff);
  out[8] = static_cast<uint8_t>((nonce >> 24) & 0xff);
  out[9] = static_cast<uint8_t>((nonce >> 16) & 0xff);
  out[10] = static_cast<uint8_t>((nonce >> 8) & 0xff);
  out[11] = static_cast<uint8_t>(nonce & 0xff);
}

} // namespace

Transport::Transport(
    CryptoBackend& backend,
    ConstByteSpan sendKey32,
    ConstByteSpan recvKey32) noexcept
    : backend_(backend) {
  if (!HasExactInputSize(sendKey32, kKeySize) ||
      !HasExactInputSize(recvKey32, kKeySize)) {
    FailClosed(Status::InvalidArgument());
    return;
  }

  CopyBytes(sendKey32, sendKey_.span());
  CopyBytes(recvKey32, recvKey_.span());
}

Transport::~Transport() noexcept {
  DestroySecrets();
}

StatusWithSize Transport::Seal(
    ConstByteSpan plaintext,
    ByteSpan ciphertextAndTagOut) noexcept {
  if (!initStatus_.ok()) {
    ZeroizeIfValid(ciphertextAndTagOut);
    return StatusWithSize(initStatus_, 0);
  }
  if (sendExhausted_) {
    ZeroizeIfValid(ciphertextAndTagOut);
    return StatusWithSize(Status::OutOfRange(), 0);
  }
  if (!IsValidInput(plaintext)) {
    ZeroizeIfValid(ciphertextAndTagOut);
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  if (plaintext.size() > std::numeric_limits<size_t>::max() - kTagSize) {
    ZeroizeIfValid(ciphertextAndTagOut);
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  const size_t outputLen = plaintext.size() + kTagSize;
  Status status = ValidateOutputAtLeast(ciphertextAndTagOut, outputLen);
  if (!status.ok()) {
    ZeroizeIfValid(ciphertextAndTagOut);
    return StatusWithSize(status, 0);
  }

  if (sendNonce_ == std::numeric_limits<uint64_t>::max()) {
    sendExhausted_ = true;
    ZeroizeIfValid(ciphertextAndTagOut.subspan(0, outputLen));
    return StatusWithSize(Status::OutOfRange(), 0);
  }

  std::array<uint8_t, kNonceSize> nonce{};
  FormatAesGcmNonce(sendNonce_, nonce);
  ByteSpan output = ciphertextAndTagOut.subspan(0, outputLen);
  status = backend_.Aes256GcmSeal(
      sendKey_.span(),
      ConstByteSpan(nonce),
      ConstByteSpan(),
      plaintext,
      output);
  Zeroize(ByteSpan(nonce));
  if (!status.ok()) {
    ZeroizeIfValid(output);
    return StatusWithSize(status, 0);
  }

  ++sendNonce_;
  return StatusWithSize(OkStatus(), outputLen);
}

StatusWithSize Transport::SealInPlace(
    ByteSpan plaintextAndCiphertext,
    size_t plaintextLen) noexcept {
  if (!IsValidOutput(plaintextAndCiphertext) ||
      plaintextLen > plaintextAndCiphertext.size()) {
    ZeroizeIfValid(plaintextAndCiphertext);
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  if (plaintextLen > std::numeric_limits<size_t>::max() - kTagSize) {
    ZeroizeIfValid(plaintextAndCiphertext);
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  const size_t outputLen = plaintextLen + kTagSize;
  if (plaintextAndCiphertext.size() < outputLen) {
    ZeroizeIfValid(plaintextAndCiphertext);
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }

  return Seal(
      ConstByteSpan(plaintextAndCiphertext.data(), plaintextLen),
      plaintextAndCiphertext.subspan(0, outputLen));
}

StatusWithSize Transport::Open(
    ConstByteSpan ciphertextAndTag,
    ByteSpan plaintextOut) noexcept {
  if (!initStatus_.ok()) {
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(initStatus_, 0);
  }
  if (receivePoisoned_) {
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (!IsValidInput(ciphertextAndTag)) {
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  if (ciphertextAndTag.size() < kTagSize) {
    receivePoisoned_ = true;
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  const size_t plaintextLen = ciphertextAndTag.size() - kTagSize;
  Status status = ValidateOutputAtLeast(plaintextOut, plaintextLen);
  if (!status.ok()) {
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(status, 0);
  }

  if (recvNonce_ == std::numeric_limits<uint64_t>::max()) {
    receivePoisoned_ = true;
    ZeroizeIfValid(plaintextOut.subspan(0, plaintextLen));
    return StatusWithSize(Status::OutOfRange(), 0);
  }

  std::array<uint8_t, kNonceSize> nonce{};
  FormatAesGcmNonce(recvNonce_, nonce);
  ByteSpan plaintext = plaintextOut.subspan(0, plaintextLen);
  status = backend_.Aes256GcmOpen(
      recvKey_.span(),
      ConstByteSpan(nonce),
      ConstByteSpan(),
      ciphertextAndTag,
      plaintext);
  Zeroize(ByteSpan(nonce));
  if (!status.ok()) {
    receivePoisoned_ = true;
    ZeroizeIfValid(plaintextOut);
    return StatusWithSize(status, 0);
  }

  ++recvNonce_;
  return StatusWithSize(OkStatus(), plaintextLen);
}

Transport::ReceiveStateSnapshot Transport::SnapshotReceiveState()
    const noexcept {
  return ReceiveStateSnapshot{recvNonce_, receivePoisoned_};
}

void Transport::RestoreReceiveState(ReceiveStateSnapshot snapshot) noexcept {
  recvNonce_ = snapshot.recv_nonce;
  receivePoisoned_ = snapshot.receive_poisoned;
}

void Transport::FailClosed(Status status) noexcept {
  DestroySecrets();
  initStatus_ = status;
  sendExhausted_ = true;
  receivePoisoned_ = true;
}

void Transport::DestroySecrets() noexcept {
  Zeroize(sendKey_.span());
  Zeroize(recvKey_.span());
  sendNonce_ = 0;
  recvNonce_ = 0;
}

} // namespace musegadgets::noise::core
