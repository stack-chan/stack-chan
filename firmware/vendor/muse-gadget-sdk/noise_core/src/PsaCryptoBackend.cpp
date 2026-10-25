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

#include <xplat/noise/core/PsaCryptoBackend.h>

#include <psa/crypto.h>
#include <algorithm>
#include <array>
#include <cstdint>

namespace musegadgets::noise::core {
namespace {

constexpr uint8_t kX25519LowByteClampMask = 0xf8;
constexpr uint8_t kX25519HighByteClearMask = 0x7f;
constexpr uint8_t kX25519HighByteSetMask = 0x40;

bool IsValidInput(ConstByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

bool IsValidOutput(ByteSpan bytes) noexcept {
  return bytes.data() != nullptr || bytes.empty();
}

bool HasExactInputSize(ConstByteSpan bytes, size_t expected) noexcept {
  return bytes.size() == expected && IsValidInput(bytes);
}

bool HasExactOutputSize(ByteSpan bytes, size_t expected) noexcept {
  return bytes.size() == expected && IsValidOutput(bytes);
}

void SecureZeroize(ByteSpan bytes) noexcept {
  volatile uint8_t* p = bytes.data();
  for (size_t i = 0; p != nullptr && i < bytes.size(); ++i) {
    p[i] = 0;
  }
}

template <size_t kSize>
void SecureZeroize(std::array<uint8_t, kSize>& bytes) noexcept {
  SecureZeroize(ByteSpan(bytes));
}

Status PsaStatusToStatus(psa_status_t status) noexcept {
  if (status == PSA_SUCCESS) {
    return OkStatus();
  }
  if (status == PSA_ERROR_INVALID_ARGUMENT) {
    return Status::InvalidArgument();
  }
  if (status == PSA_ERROR_BUFFER_TOO_SMALL ||
      status == PSA_ERROR_INSUFFICIENT_MEMORY ||
      status == PSA_ERROR_INSUFFICIENT_STORAGE) {
    return Status::ResourceExhausted();
  }
  if (status == PSA_ERROR_INVALID_SIGNATURE) {
    return Status::Unauthenticated();
  }
  if (status == PSA_ERROR_BAD_STATE ||
      status == PSA_ERROR_INSUFFICIENT_ENTROPY ||
      status == PSA_ERROR_NOT_SUPPORTED) {
    return Status::Unavailable();
  }
  return Status::Internal();
}

Status EnsureInitialized() noexcept {
  return PsaStatusToStatus(psa_crypto_init());
}

class PsaKey {
 public:
  PsaKey() noexcept = default;

  ~PsaKey() noexcept {
    Reset();
  }

  PsaKey(const PsaKey&) = delete;
  PsaKey& operator=(const PsaKey&) = delete;
  PsaKey(PsaKey&&) = delete;
  PsaKey& operator=(PsaKey&&) = delete;

  psa_key_id_t get() const noexcept {
    return key_;
  }

  psa_key_id_t* Out() noexcept {
    Reset();
    return &key_;
  }

  void Reset() noexcept {
    if (key_ != PSA_KEY_ID_NULL) {
      psa_destroy_key(key_);
      key_ = PSA_KEY_ID_NULL;
    }
  }

 private:
  psa_key_id_t key_{PSA_KEY_ID_NULL};
};

const uint8_t* PsaData(ConstByteSpan bytes) noexcept {
  static constexpr uint8_t kEmptyData = 0;
  return bytes.empty() ? &kEmptyData : bytes.data();
}

uint8_t* PsaData(ByteSpan bytes) noexcept {
  static uint8_t kEmptyData = 0;
  return bytes.empty() ? &kEmptyData : bytes.data();
}

bool IsAllZero(ConstByteSpan bytes) noexcept {
  uint8_t anyBitsSet = 0;
  for (size_t i = 0; i < bytes.size(); ++i) {
    anyBitsSet = static_cast<uint8_t>(anyBitsSet | bytes[i]);
  }
  return anyBitsSet == 0;
}

bool RangesOverlap(
    const uint8_t* firstData,
    size_t firstSize,
    const uint8_t* secondData,
    size_t secondSize) noexcept {
  if (firstSize == 0 || secondSize == 0) {
    return false;
  }
  if (firstData == nullptr || secondData == nullptr) {
    return false;
  }
  const uintptr_t firstBegin = reinterpret_cast<uintptr_t>(firstData);
  const uintptr_t secondBegin = reinterpret_cast<uintptr_t>(secondData);
  const uintptr_t firstEnd = firstBegin + firstSize;
  const uintptr_t secondEnd = secondBegin + secondSize;
  return firstBegin < secondEnd && secondBegin < firstEnd;
}

bool IsExactInPlacePrefix(
    ConstByteSpan input,
    ByteSpan output,
    size_t outputPrefixLen) noexcept {
  return input.size() == outputPrefixLen && input.data() == output.data();
}

Status ValidateAesInputs(
    ConstByteSpan key32,
    ConstByteSpan nonce12,
    ConstByteSpan aad) noexcept {
  if (!HasExactInputSize(key32, CryptoBackend::kAes256GcmKeySize) ||
      !HasExactInputSize(nonce12, CryptoBackend::kAes256GcmNonceSize) ||
      !IsValidInput(aad)) {
    return Status::InvalidArgument();
  }
  return OkStatus();
}

void ClampX25519PrivateKey(
    ConstByteSpan privateKey32,
    std::array<uint8_t, CryptoBackend::kX25519KeySize>& out) noexcept {
  std::copy_n(privateKey32.data(), out.size(), out.data());
  out[0] &= kX25519LowByteClampMask;
  out[31] &= kX25519HighByteClearMask;
  out[31] |= kX25519HighByteSetMask;
}

Status ImportX25519PrivateKey(
    ConstByteSpan privateKey32,
    psa_key_usage_t usage,
    PsaKey& key) noexcept {
  std::array<uint8_t, CryptoBackend::kX25519KeySize> clamped{};
  ClampX25519PrivateKey(privateKey32, clamped);

  psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_usage_flags(&attributes, usage);
  psa_set_key_lifetime(&attributes, PSA_KEY_LIFETIME_VOLATILE);
  psa_set_key_algorithm(&attributes, PSA_ALG_ECDH);
  psa_set_key_type(
      &attributes, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_MONTGOMERY));
  psa_set_key_bits(&attributes, 255);

  const psa_status_t status =
      psa_import_key(&attributes, clamped.data(), clamped.size(), key.Out());
  psa_reset_key_attributes(&attributes);
  SecureZeroize(clamped);
  return PsaStatusToStatus(status);
}

Status
ImportAesKey(ConstByteSpan key32, psa_key_usage_t usage, PsaKey& key) noexcept {
  psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_usage_flags(&attributes, usage);
  psa_set_key_lifetime(&attributes, PSA_KEY_LIFETIME_VOLATILE);
  psa_set_key_algorithm(&attributes, PSA_ALG_GCM);
  psa_set_key_type(&attributes, PSA_KEY_TYPE_AES);
  psa_set_key_bits(&attributes, CryptoBackend::kAes256GcmKeySize * 8);

  const psa_status_t status =
      psa_import_key(&attributes, key32.data(), key32.size(), key.Out());
  psa_reset_key_attributes(&attributes);
  return PsaStatusToStatus(status);
}

Status ImportHmacKey(ConstByteSpan bytes, PsaKey& key) noexcept {
  psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
  psa_set_key_lifetime(&attributes, PSA_KEY_LIFETIME_VOLATILE);
  psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
  psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
  psa_set_key_bits(&attributes, bytes.size() * 8);

  const psa_status_t status =
      psa_import_key(&attributes, PsaData(bytes), bytes.size(), key.Out());
  psa_reset_key_attributes(&attributes);
  return PsaStatusToStatus(status);
}

Status HmacSha256(
    psa_key_id_t key,
    ConstByteSpan first,
    ConstByteSpan second,
    ConstByteSpan third,
    ByteSpan digest32) noexcept {
  if (!HasExactOutputSize(digest32, CryptoBackend::kSha256DigestSize)) {
    return Status::InvalidArgument();
  }

  psa_mac_operation_t operation = PSA_MAC_OPERATION_INIT;
  psa_status_t status =
      psa_mac_sign_setup(&operation, key, PSA_ALG_HMAC(PSA_ALG_SHA_256));
  if (status != PSA_SUCCESS) {
    return PsaStatusToStatus(status);
  }

  Status result = OkStatus();
  if (!first.empty()) {
    result = PsaStatusToStatus(
        psa_mac_update(&operation, first.data(), first.size()));
  }
  if (result.ok() && !second.empty()) {
    result = PsaStatusToStatus(
        psa_mac_update(&operation, second.data(), second.size()));
  }
  if (result.ok() && !third.empty()) {
    result = PsaStatusToStatus(
        psa_mac_update(&operation, third.data(), third.size()));
  }

  size_t macLen = 0;
  if (result.ok()) {
    result = PsaStatusToStatus(psa_mac_sign_finish(
        &operation, digest32.data(), digest32.size(), &macLen));
    if (result.ok() && macLen != CryptoBackend::kSha256DigestSize) {
      result = Status::Internal();
    }
  }
  if (!result.ok()) {
    psa_mac_abort(&operation);
    SecureZeroize(digest32);
  }
  return result;
}

} // namespace

Status PsaCryptoBackend::Random(ByteSpan out) noexcept {
  if (!IsValidOutput(out)) {
    return Status::InvalidArgument();
  }
  if (out.empty()) {
    return OkStatus();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }
  return PsaStatusToStatus(psa_generate_random(out.data(), out.size()));
}

Status PsaCryptoBackend::X25519GenerateKeypair(
    ByteSpan privateKey32,
    ByteSpan publicKey32) noexcept {
  if (!HasExactOutputSize(privateKey32, kX25519KeySize) ||
      !HasExactOutputSize(publicKey32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_usage_flags(
      &attributes, PSA_KEY_USAGE_DERIVE | PSA_KEY_USAGE_EXPORT);
  psa_set_key_lifetime(&attributes, PSA_KEY_LIFETIME_VOLATILE);
  psa_set_key_algorithm(&attributes, PSA_ALG_ECDH);
  psa_set_key_type(
      &attributes, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_MONTGOMERY));
  psa_set_key_bits(&attributes, 255);

  PsaKey key;
  status = PsaStatusToStatus(psa_generate_key(&attributes, key.Out()));
  psa_reset_key_attributes(&attributes);
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kX25519KeySize> privateKey{};
  std::array<uint8_t, kX25519KeySize> publicKey{};
  size_t privateKeyLen = 0;
  size_t publicKeyLen = 0;
  status = PsaStatusToStatus(psa_export_key(
      key.get(), privateKey.data(), privateKey.size(), &privateKeyLen));
  if (status.ok()) {
    status = PsaStatusToStatus(psa_export_public_key(
        key.get(), publicKey.data(), publicKey.size(), &publicKeyLen));
  }
  if (!status.ok() || privateKeyLen != kX25519KeySize ||
      publicKeyLen != kX25519KeySize) {
    SecureZeroize(privateKey);
    return status.ok() ? Status::Internal() : status;
  }

  std::copy(privateKey.begin(), privateKey.end(), privateKey32.data());
  std::copy(publicKey.begin(), publicKey.end(), publicKey32.data());
  SecureZeroize(privateKey);
  return OkStatus();
}

Status PsaCryptoBackend::X25519PublicFromPrivate(
    ConstByteSpan privateKey32,
    ByteSpan publicKey32) noexcept {
  if (!HasExactInputSize(privateKey32, kX25519KeySize) ||
      !HasExactOutputSize(publicKey32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  PsaKey key;
  status = ImportX25519PrivateKey(
      privateKey32, PSA_KEY_USAGE_DERIVE | PSA_KEY_USAGE_EXPORT, key);
  if (!status.ok()) {
    return status;
  }

  size_t publicKeyLen = 0;
  status = PsaStatusToStatus(psa_export_public_key(
      key.get(), publicKey32.data(), publicKey32.size(), &publicKeyLen));
  if (!status.ok()) {
    SecureZeroize(publicKey32);
    return status;
  }
  if (publicKeyLen != kX25519KeySize) {
    SecureZeroize(publicKey32);
    return Status::Internal();
  }
  return OkStatus();
}

Status PsaCryptoBackend::X25519Dh(
    ConstByteSpan privateKey32,
    ConstByteSpan peerPublic32,
    ByteSpan sharedSecret32) noexcept {
  if (!HasExactInputSize(privateKey32, kX25519KeySize) ||
      !HasExactInputSize(peerPublic32, kX25519KeySize) ||
      !HasExactOutputSize(sharedSecret32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  PsaKey key;
  status = ImportX25519PrivateKey(privateKey32, PSA_KEY_USAGE_DERIVE, key);
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kX25519KeySize> shared{};
  size_t sharedLen = 0;
  status = PsaStatusToStatus(psa_raw_key_agreement(
      PSA_ALG_ECDH,
      key.get(),
      peerPublic32.data(),
      peerPublic32.size(),
      shared.data(),
      shared.size(),
      &sharedLen));
  if (status.ok() && sharedLen != kX25519KeySize) {
    status = Status::Internal();
  }
  if (status.ok() && IsAllZero(ConstByteSpan(shared))) {
    status = Status::InvalidArgument();
  }
  if (status.ok()) {
    std::copy(shared.begin(), shared.end(), sharedSecret32.data());
  }
  SecureZeroize(shared);
  return status;
}

Status PsaCryptoBackend::Sha256(
    ConstByteSpan data,
    ByteSpan digest32) noexcept {
  if (!IsValidInput(data) || !HasExactOutputSize(digest32, kSha256DigestSize)) {
    return Status::InvalidArgument();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  size_t digestLen = 0;
  status = PsaStatusToStatus(psa_hash_compute(
      PSA_ALG_SHA_256,
      PsaData(data),
      data.size(),
      digest32.data(),
      digest32.size(),
      &digestLen));
  if (!status.ok() || digestLen != kSha256DigestSize) {
    SecureZeroize(digest32);
    return status.ok() ? Status::Internal() : status;
  }
  return OkStatus();
}

Status PsaCryptoBackend::Sha256Concat(
    ConstByteSpan prefix,
    ConstByteSpan suffix,
    ByteSpan digest32) noexcept {
  if (!IsValidInput(prefix) || !IsValidInput(suffix) ||
      !HasExactOutputSize(digest32, kSha256DigestSize)) {
    return Status::InvalidArgument();
  }
  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  psa_hash_operation_t operation = PSA_HASH_OPERATION_INIT;
  status = PsaStatusToStatus(psa_hash_setup(&operation, PSA_ALG_SHA_256));
  if (status.ok() && !prefix.empty()) {
    status = PsaStatusToStatus(
        psa_hash_update(&operation, prefix.data(), prefix.size()));
  }
  if (status.ok() && !suffix.empty()) {
    status = PsaStatusToStatus(
        psa_hash_update(&operation, suffix.data(), suffix.size()));
  }

  size_t digestLen = 0;
  if (status.ok()) {
    status = PsaStatusToStatus(psa_hash_finish(
        &operation, digest32.data(), digest32.size(), &digestLen));
    if (status.ok() && digestLen != kSha256DigestSize) {
      status = Status::Internal();
    }
  }
  if (!status.ok()) {
    psa_hash_abort(&operation);
    SecureZeroize(digest32);
  }
  return status;
}

Status PsaCryptoBackend::HkdfSha256(
    ConstByteSpan salt,
    ConstByteSpan ikm,
    ConstByteSpan info,
    Span<ByteSpan> outputs) noexcept {
  if (!IsValidInput(salt) || !IsValidInput(ikm) || !IsValidInput(info) ||
      outputs.data() == nullptr || outputs.empty() ||
      outputs.size() > kMaxHkdfSha256Outputs) {
    return Status::InvalidArgument();
  }
  for (size_t i = 0; i < outputs.size(); ++i) {
    if (!HasExactOutputSize(outputs[i], kSha256DigestSize)) {
      return Status::InvalidArgument();
    }
  }

  Status status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kSha256DigestSize> zeroSalt{};
  const ConstByteSpan hmacSalt = salt.empty() ? ConstByteSpan(zeroSalt) : salt;
  PsaKey saltKey;
  status = ImportHmacKey(hmacSalt, saltKey);
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kSha256DigestSize> prk{};
  status = HmacSha256(
      saltKey.get(), ikm, ConstByteSpan(), ConstByteSpan(), ByteSpan(prk));
  if (!status.ok()) {
    SecureZeroize(prk);
    return status;
  }

  PsaKey prkKey;
  status = ImportHmacKey(ConstByteSpan(prk), prkKey);
  SecureZeroize(prk);
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kSha256DigestSize * kMaxHkdfSha256Outputs> okm{};
  std::array<uint8_t, 1> counter{};
  for (size_t i = 0; status.ok() && i < outputs.size(); ++i) {
    counter[0] = static_cast<uint8_t>(i + 1);
    const ConstByteSpan previous = i == 0
        ? ConstByteSpan()
        : ConstByteSpan(
              okm.data() + ((i - 1) * kSha256DigestSize), kSha256DigestSize);
    status = HmacSha256(
        prkKey.get(),
        previous,
        info,
        ConstByteSpan(counter),
        ByteSpan(okm.data() + (i * kSha256DigestSize), kSha256DigestSize));
  }

  if (!status.ok()) {
    SecureZeroize(okm);
    return status;
  }

  for (size_t i = 0; i < outputs.size(); ++i) {
    std::copy_n(
        okm.data() + (i * kSha256DigestSize),
        kSha256DigestSize,
        outputs[i].data());
  }
  SecureZeroize(okm);
  return OkStatus();
}

Status PsaCryptoBackend::Aes256GcmSeal(
    ConstByteSpan key32,
    ConstByteSpan nonce12,
    ConstByteSpan aad,
    ConstByteSpan plaintext,
    ByteSpan ciphertextAndTagOut) noexcept {
  Status status = ValidateAesInputs(key32, nonce12, aad);
  if (!status.ok()) {
    return status;
  }
  if (!IsValidInput(plaintext) ||
      ciphertextAndTagOut.size() != plaintext.size() + kAes256GcmTagSize ||
      !IsValidOutput(ciphertextAndTagOut)) {
    return Status::InvalidArgument();
  }
  if (RangesOverlap(
          plaintext.data(),
          plaintext.size(),
          ciphertextAndTagOut.data(),
          ciphertextAndTagOut.size()) &&
      !IsExactInPlacePrefix(plaintext, ciphertextAndTagOut, plaintext.size())) {
    return Status::InvalidArgument();
  }

  status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }
  PsaKey key;
  status = ImportAesKey(key32, PSA_KEY_USAGE_ENCRYPT, key);
  if (!status.ok()) {
    return status;
  }

  size_t outputLen = 0;
  status = PsaStatusToStatus(psa_aead_encrypt(
      key.get(),
      PSA_ALG_GCM,
      nonce12.data(),
      nonce12.size(),
      PsaData(aad),
      aad.size(),
      PsaData(plaintext),
      plaintext.size(),
      ciphertextAndTagOut.data(),
      ciphertextAndTagOut.size(),
      &outputLen));
  if (!status.ok() || outputLen != ciphertextAndTagOut.size()) {
    SecureZeroize(ciphertextAndTagOut);
    return status.ok() ? Status::Internal() : status;
  }
  return OkStatus();
}

Status PsaCryptoBackend::Aes256GcmOpen(
    ConstByteSpan key32,
    ConstByteSpan nonce12,
    ConstByteSpan aad,
    ConstByteSpan ciphertextAndTag,
    ByteSpan plaintextOut) noexcept {
  Status status = ValidateAesInputs(key32, nonce12, aad);
  if (!status.ok()) {
    return status;
  }
  if (!IsValidInput(ciphertextAndTag) ||
      ciphertextAndTag.size() < kAes256GcmTagSize) {
    return Status::InvalidArgument();
  }
  const size_t plaintextLen = ciphertextAndTag.size() - kAes256GcmTagSize;
  if (!HasExactOutputSize(plaintextOut, plaintextLen)) {
    return Status::InvalidArgument();
  }

  status = EnsureInitialized();
  if (!status.ok()) {
    return status;
  }
  PsaKey key;
  status = ImportAesKey(key32, PSA_KEY_USAGE_DECRYPT, key);
  if (!status.ok()) {
    return status;
  }

  size_t outputLen = 0;
  status = PsaStatusToStatus(psa_aead_decrypt(
      key.get(),
      PSA_ALG_GCM,
      nonce12.data(),
      nonce12.size(),
      PsaData(aad),
      aad.size(),
      PsaData(ciphertextAndTag),
      ciphertextAndTag.size(),
      PsaData(plaintextOut),
      plaintextOut.size(),
      &outputLen));
  if (!status.ok() || outputLen != plaintextLen) {
    SecureZeroize(plaintextOut);
    return status.ok() ? Status::Internal() : status;
  }
  return OkStatus();
}

} // namespace musegadgets::noise::core
