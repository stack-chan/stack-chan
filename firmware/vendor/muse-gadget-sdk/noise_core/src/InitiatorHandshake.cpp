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

#include <xplat/noise/core/InitiatorHandshake.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>

namespace musegadgets::noise::core {
namespace {

constexpr char kProtocolName[] = "Noise_XX_25519_AESGCM_SHA256";
constexpr size_t kProtocolNameSize = sizeof(kProtocolName) - 1;
constexpr size_t kHashSize = CryptoBackend::kSha256DigestSize;
static_assert(kProtocolNameSize <= kHashSize);
static_assert(InitiatorHandshake::kKeySize == kHashSize);
static_assert(
    CryptoBackend::kAes256GcmNonceSize == 12,
    "Noise AES-GCM nonce formatter assumes 96-bit nonces");

bool IsValidInput(ConstByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
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

Status ValidateOutputExact(ByteSpan out, size_t required) noexcept {
  if (out.size() != required) {
    return out.size() < required ? Status::ResourceExhausted()
                                 : Status::InvalidArgument();
  }
  if (!IsValidOutput(out)) {
    return Status::InvalidArgument();
  }
  return OkStatus();
}

void CopyBytes(ConstByteSpan from, ByteSpan to) noexcept {
  for (size_t i = 0; i < from.size(); ++i) {
    to[i] = from[i];
  }
}

void CopyToArray(
    ConstByteSpan from,
    std::array<uint8_t, InitiatorHandshake::kKeySize>& to) noexcept {
  for (size_t i = 0; i < to.size(); ++i) {
    to[i] = from[i];
  }
}

void FormatAesGcmNonce(
    uint64_t nonce,
    std::array<uint8_t, CryptoBackend::kAes256GcmNonceSize>& out) noexcept {
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

Status PeerDataStatus(Status status) noexcept {
  if (status.IsUnauthenticated()) {
    return Status::Unauthenticated();
  }
  if (status.IsInvalidArgument()) {
    return Status::DataLoss();
  }
  return status;
}

bool RangesOverlap(
    const uint8_t* lhs,
    size_t lhsSize,
    const uint8_t* rhs,
    size_t rhsSize) noexcept {
  if (lhsSize == 0 || rhsSize == 0) {
    return false;
  }
  if (lhs == nullptr || rhs == nullptr) {
    return false;
  }
  const uintptr_t lhsBegin = reinterpret_cast<uintptr_t>(lhs);
  const uintptr_t rhsBegin = reinterpret_cast<uintptr_t>(rhs);
  const uintptr_t lhsEnd = lhsBegin + lhsSize;
  const uintptr_t rhsEnd = rhsBegin + rhsSize;
  return lhsBegin < rhsEnd && rhsBegin < lhsEnd;
}

} // namespace

InitiatorHandshake::InitiatorHandshake(CryptoBackend& backend) noexcept
    : backend_(backend) {
  InitializeSymmetric();
}

InitiatorHandshake::~InitiatorHandshake() noexcept {
  DestroySecrets();
}

StatusWithSize InitiatorHandshake::WriteMessage1(ByteSpan out) noexcept {
  if (stage_ != Stage::Init) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  Status status = ValidateOutputAtLeast(out, kMessage1Size);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }

  status = EnsureStaticKeypair();
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }
  status = EnsureEphemeralKeypair();
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }

  status = MixHash(ConstByteSpan());
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }
  status = MixHash(ConstByteSpan(ephemeralPublicKey_));
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }
  status = EncryptAndHash(ConstByteSpan(), ByteSpan());
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }

  CopyBytes(ConstByteSpan(ephemeralPublicKey_), out.subspan(0, kMessage1Size));
  stage_ = Stage::WroteMessage1;
  return StatusWithSize(OkStatus(), kMessage1Size);
}

Status InitiatorHandshake::ReadMessage2(
    ConstByteSpan msg2,
    ByteSpan peerExtraOut,
    size_t& peerExtraWritten) noexcept {
  peerExtraWritten = 0;
  if (stage_ != Stage::WroteMessage1) {
    return Status::FailedPrecondition();
  }
  if (!IsValidInput(msg2)) {
    return Status::InvalidArgument();
  }
  if (msg2.size() < kMinMessage2Size || msg2.size() > kMaxMessageSize) {
    Poison();
    return Status::InvalidArgument();
  }

  constexpr size_t kMessage2HeaderSize = kKeySize + kStaticCiphertextSize;
  const size_t payloadCiphertextSize = msg2.size() - kMessage2HeaderSize;
  const size_t payloadPlaintextSize =
      payloadCiphertextSize - CryptoBackend::kAes256GcmTagSize;
  Status status = ValidateOutputAtLeast(peerExtraOut, payloadPlaintextSize);
  if (!status.ok()) {
    return status;
  }

  const ConstByteSpan remoteEphemeral = msg2.subspan(0, kKeySize);
  SecretArray<kKeySize> dhOutput;
  status = backend_.X25519Dh(
      ephemeralPrivateKey_.span(), remoteEphemeral, dhOutput.span());
  if (!status.ok()) {
    Poison();
    return PeerDataStatus(status);
  }

  CopyToArray(remoteEphemeral, remoteEphemeralPublicKey_);
  status = MixHash(remoteEphemeral);
  if (!status.ok()) {
    Poison();
    return status;
  }
  status = MixKey(dhOutput.span());
  if (!status.ok()) {
    Poison();
    return status;
  }
  Zeroize(dhOutput.span());

  std::array<uint8_t, kKeySize> decryptedStatic{};
  status = DecryptAndHash(
      msg2.subspan(kKeySize, kStaticCiphertextSize), ByteSpan(decryptedStatic));
  if (!status.ok()) {
    Zeroize(ByteSpan(decryptedStatic));
    Poison();
    return PeerDataStatus(status);
  }
  CopyToArray(ConstByteSpan(decryptedStatic), peerStaticPublicKey_);
  Zeroize(ByteSpan(decryptedStatic));

  status = backend_.X25519Dh(
      ephemeralPrivateKey_.span(),
      ConstByteSpan(peerStaticPublicKey_),
      dhOutput.span());
  Zeroize(ephemeralPrivateKey_.span());
  if (!status.ok()) {
    Poison();
    return PeerDataStatus(status);
  }
  status = MixKey(dhOutput.span());
  if (!status.ok()) {
    Poison();
    return status;
  }
  Zeroize(dhOutput.span());

  status = DecryptAndHash(
      msg2.subspan(kMessage2HeaderSize, payloadCiphertextSize),
      peerExtraOut.subspan(0, payloadPlaintextSize));
  if (!status.ok()) {
    Poison();
    return PeerDataStatus(status);
  }

  peerExtraWritten = payloadPlaintextSize;
  stage_ = Stage::ReadMessage2;
  return OkStatus();
}

StatusWithSize InitiatorHandshake::WriteMessage3(
    ConstByteSpan initiatorPayload,
    ByteSpan out) noexcept {
  if (stage_ != Stage::ReadMessage2) {
    return StatusWithSize(Status::FailedPrecondition(), 0);
  }
  if (!IsValidInput(initiatorPayload)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }
  if (initiatorPayload.size() > kMaxMessage3PayloadSize) {
    return StatusWithSize(Status::ResourceExhausted(), 0);
  }
  const size_t messageSize = kMinMessage3Size + initiatorPayload.size();
  Status status = ValidateOutputAtLeast(out, messageSize);
  if (!status.ok()) {
    return StatusWithSize(status, 0);
  }
  if (RangesOverlap(
          initiatorPayload.data(),
          initiatorPayload.size(),
          out.data(),
          messageSize)) {
    return StatusWithSize(Status::InvalidArgument(), 0);
  }

  status = EncryptAndHash(
      ConstByteSpan(staticPublicKey_), out.subspan(0, kStaticCiphertextSize));
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }

  SecretArray<kKeySize> dhOutput;
  status = backend_.X25519Dh(
      staticPrivateKey_.span(),
      ConstByteSpan(remoteEphemeralPublicKey_),
      dhOutput.span());
  Zeroize(staticPrivateKey_.span());
  if (!status.ok()) {
    Poison();
    return StatusWithSize(PeerDataStatus(status), 0);
  }
  status = MixKey(dhOutput.span());
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }
  Zeroize(dhOutput.span());

  status = EncryptAndHash(
      initiatorPayload,
      out.subspan(
          kStaticCiphertextSize,
          initiatorPayload.size() + CryptoBackend::kAes256GcmTagSize));
  if (!status.ok()) {
    Poison();
    return StatusWithSize(status, 0);
  }

  stage_ = Stage::WroteMessage3;
  return StatusWithSize(OkStatus(), messageSize);
}

Status InitiatorHandshake::Finalize(
    ByteSpan sendKey32,
    ByteSpan recvKey32) noexcept {
  if (stage_ != Stage::WroteMessage3) {
    return Status::FailedPrecondition();
  }
  Status status = ValidateOutputAtLeast(sendKey32, kKeySize);
  if (!status.ok()) {
    return status;
  }
  status = ValidateOutputAtLeast(recvKey32, kKeySize);
  if (!status.ok()) {
    return status;
  }

  SecretArray<kKeySize> key1;
  SecretArray<kKeySize> key2;
  status = Split(key1.span(), key2.span());
  if (!status.ok()) {
    Poison();
    return status;
  }

  CopyBytes(key1.span(), sendKey32.subspan(0, kKeySize));
  CopyBytes(key2.span(), recvKey32.subspan(0, kKeySize));
  DestroySecrets();
  stage_ = Stage::Finalized;
  return OkStatus();
}

Status InitiatorHandshake::EnsureStaticKeypair() noexcept {
  if (staticInjected_) {
    return OkStatus();
  }
  Status status = backend_.X25519GenerateKeypair(
      staticPrivateKey_.span(), ByteSpan(staticPublicKey_));
  if (!status.ok()) {
    Zeroize(staticPrivateKey_.span());
    Zeroize(ByteSpan(staticPublicKey_));
    return status;
  }
  staticInjected_ = true;
  return OkStatus();
}

Status InitiatorHandshake::EnsureEphemeralKeypair() noexcept {
  if (ephemeralInjected_) {
    return OkStatus();
  }
  Status status = backend_.X25519GenerateKeypair(
      ephemeralPrivateKey_.span(), ByteSpan(ephemeralPublicKey_));
  if (!status.ok()) {
    Zeroize(ephemeralPrivateKey_.span());
    Zeroize(ByteSpan(ephemeralPublicKey_));
    return status;
  }
  ephemeralInjected_ = true;
  return OkStatus();
}

Status InitiatorHandshake::MixHash(ConstByteSpan data) noexcept {
  if (!IsValidInput(data)) {
    return Status::InvalidArgument();
  }
  if (data.size() > kMaxMessageSize) {
    return Status::ResourceExhausted();
  }

  std::array<uint8_t, kHashSize> nextHash{};
  Status status = backend_.Sha256Concat(
      ConstByteSpan(handshakeHash_), data, ByteSpan(nextHash));
  if (!status.ok()) {
    Zeroize(ByteSpan(nextHash));
    return status;
  }
  handshakeHash_ = nextHash;
  Zeroize(ByteSpan(nextHash));
  return OkStatus();
}

Status InitiatorHandshake::MixKey(ConstByteSpan inputKeyMaterial) noexcept {
  if (!IsValidInput(inputKeyMaterial)) {
    return Status::InvalidArgument();
  }

  SecretArray<kKeySize> nextChainingKey;
  SecretArray<kKeySize> nextCipherKey;
  std::array<ByteSpan, 2> outputs = {
      {nextChainingKey.span(), nextCipherKey.span()}};
  Status status = backend_.HkdfSha256(
      chainingKey_.span(),
      inputKeyMaterial,
      ConstByteSpan(),
      Span<ByteSpan>(outputs));
  if (!status.ok()) {
    return status;
  }

  CopyBytes(nextChainingKey.span(), chainingKey_.span());
  CopyBytes(nextCipherKey.span(), cipherKey_.span());
  hasCipherKey_ = true;
  cipherNonce_ = 0;
  return OkStatus();
}

Status InitiatorHandshake::EncryptAndHash(
    ConstByteSpan plaintext,
    ByteSpan ciphertextOut) noexcept {
  if (!IsValidInput(plaintext)) {
    return Status::InvalidArgument();
  }

  const size_t ciphertextSize =
      plaintext.size() + (hasCipherKey_ ? CryptoBackend::kAes256GcmTagSize : 0);
  Status status = ValidateOutputExact(ciphertextOut, ciphertextSize);
  if (!status.ok()) {
    return status;
  }

  if (!hasCipherKey_) {
    CopyBytes(plaintext, ciphertextOut);
    return MixHash(ciphertextOut);
  }
  if (cipherNonce_ == std::numeric_limits<uint64_t>::max()) {
    return Status::OutOfRange();
  }

  std::array<uint8_t, CryptoBackend::kAes256GcmNonceSize> nonce{};
  FormatAesGcmNonce(cipherNonce_, nonce);
  status = backend_.Aes256GcmSeal(
      cipherKey_.span(),
      ConstByteSpan(nonce),
      ConstByteSpan(handshakeHash_),
      plaintext,
      ciphertextOut);
  Zeroize(ByteSpan(nonce));
  if (!status.ok()) {
    return status;
  }
  ++cipherNonce_;
  return MixHash(ciphertextOut);
}

Status InitiatorHandshake::DecryptAndHash(
    ConstByteSpan ciphertext,
    ByteSpan plaintextOut) noexcept {
  if (!IsValidInput(ciphertext)) {
    return Status::InvalidArgument();
  }

  if (!hasCipherKey_) {
    Status status = ValidateOutputExact(plaintextOut, ciphertext.size());
    if (!status.ok()) {
      return status;
    }
    CopyBytes(ciphertext, plaintextOut);
    return MixHash(ciphertext);
  }
  if (ciphertext.size() < CryptoBackend::kAes256GcmTagSize) {
    return Status::InvalidArgument();
  }
  const size_t plaintextSize =
      ciphertext.size() - CryptoBackend::kAes256GcmTagSize;
  Status status = ValidateOutputExact(plaintextOut, plaintextSize);
  if (!status.ok()) {
    return status;
  }
  if (cipherNonce_ == std::numeric_limits<uint64_t>::max()) {
    return Status::OutOfRange();
  }

  std::array<uint8_t, CryptoBackend::kAes256GcmNonceSize> nonce{};
  FormatAesGcmNonce(cipherNonce_, nonce);
  status = backend_.Aes256GcmOpen(
      cipherKey_.span(),
      ConstByteSpan(nonce),
      ConstByteSpan(handshakeHash_),
      ciphertext,
      plaintextOut);
  Zeroize(ByteSpan(nonce));
  if (!status.ok()) {
    return status;
  }
  ++cipherNonce_;
  return MixHash(ciphertext);
}

Status InitiatorHandshake::Split(ByteSpan key1Out, ByteSpan key2Out) noexcept {
  Status status = ValidateOutputExact(key1Out, kKeySize);
  if (!status.ok()) {
    return status;
  }
  status = ValidateOutputExact(key2Out, kKeySize);
  if (!status.ok()) {
    return status;
  }

  std::array<ByteSpan, 2> outputs = {{key1Out, key2Out}};
  return backend_.HkdfSha256(
      chainingKey_.span(),
      ConstByteSpan(),
      ConstByteSpan(),
      Span<ByteSpan>(outputs));
}

void InitiatorHandshake::InitializeSymmetric() noexcept {
  handshakeHash_.fill(0);
  for (size_t i = 0; i < kProtocolNameSize; ++i) {
    handshakeHash_[i] = static_cast<uint8_t>(kProtocolName[i]);
  }
  CopyBytes(ConstByteSpan(handshakeHash_), chainingKey_.span());
  hasCipherKey_ = false;
  cipherNonce_ = 0;
}

void InitiatorHandshake::DestroySecrets() noexcept {
  Zeroize(staticPrivateKey_.span());
  Zeroize(ephemeralPrivateKey_.span());
  Zeroize(chainingKey_.span());
  Zeroize(cipherKey_.span());
  Zeroize(ByteSpan(handshakeHash_));
  hasCipherKey_ = false;
  cipherNonce_ = 0;
}

void InitiatorHandshake::Poison() noexcept {
  DestroySecrets();
  Zeroize(ByteSpan(remoteEphemeralPublicKey_));
  Zeroize(ByteSpan(peerStaticPublicKey_));
  stage_ = Stage::Poisoned;
}

} // namespace musegadgets::noise::core
