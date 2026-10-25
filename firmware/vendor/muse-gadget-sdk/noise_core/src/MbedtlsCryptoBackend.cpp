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

#include <xplat/noise/core/MbedtlsCryptoBackend.h>

// mbedtls's `ecp.h` wraps low-level fields behind `MBEDTLS_PRIVATE(member)`.
// This backend needs the Curve25519 group/scalar/point fields so it can match
// the existing noise core X25519 little-endian wire semantics.
#pragma push_macro("MBEDTLS_ALLOW_PRIVATE_ACCESS")
#ifndef MBEDTLS_ALLOW_PRIVATE_ACCESS
#define MBEDTLS_ALLOW_PRIVATE_ACCESS
#endif
#include <mbedtls/bignum.h>
#include <mbedtls/ecp.h>
#pragma pop_macro("MBEDTLS_ALLOW_PRIVATE_ACCESS")

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/gcm.h>
#include <mbedtls/hkdf.h>
#include <mbedtls/md.h>
#include <mbedtls/platform_util.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <mutex>

namespace musegadgets::noise::core {
namespace {

constexpr uint8_t kX25519LowByteClampMask = 0xf8;
constexpr uint8_t kX25519HighByteClearMask = 0x7f;
constexpr uint8_t kX25519HighByteSetMask = 0x40;
constexpr unsigned int kAes256GcmKeyBits =
    static_cast<unsigned int>(CryptoBackend::kAes256GcmKeySize * 8);
constexpr char kRandomPersonalization[] = "noise/core/mbedtls";

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
  if (bytes.data() != nullptr && bytes.size() != 0) {
    mbedtls_platform_zeroize(bytes.data(), bytes.size());
  }
}

template <size_t kSize>
void SecureZeroize(std::array<uint8_t, kSize>& bytes) noexcept {
  SecureZeroize(ByteSpan(bytes));
}

class RandomState {
 public:
  RandomState() noexcept {
    mbedtls_entropy_init(&entropy_);
    mbedtls_ctr_drbg_init(&ctrDrbg_);
  }

  ~RandomState() noexcept {
    mbedtls_ctr_drbg_free(&ctrDrbg_);
    mbedtls_entropy_free(&entropy_);
  }

  RandomState(const RandomState&) = delete;
  RandomState& operator=(const RandomState&) = delete;
  RandomState(RandomState&&) = delete;
  RandomState& operator=(RandomState&&) = delete;

  Status Fill(ByteSpan out) noexcept {
    if (!IsValidOutput(out)) {
      return Status::InvalidArgument();
    }
    if (out.empty()) {
      return OkStatus();
    }

    std::lock_guard<std::mutex> lock(mutex_);
    Status status = EnsureSeededLocked();
    if (!status.ok()) {
      return status;
    }

    size_t offset = 0;
    while (offset < out.size()) {
      const size_t chunk = std::min(
          out.size() - offset,
          static_cast<size_t>(MBEDTLS_CTR_DRBG_MAX_REQUEST));
      if (mbedtls_ctr_drbg_random(&ctrDrbg_, out.data() + offset, chunk) != 0) {
        return Status::Internal();
      }
      offset += chunk;
    }
    return OkStatus();
  }

  static int
  Callback(void* pRng, unsigned char* output, size_t outputLen) noexcept {
    if (pRng == nullptr || (output == nullptr && outputLen != 0)) {
      return MBEDTLS_ERR_CTR_DRBG_REQUEST_TOO_BIG;
    }
    return static_cast<RandomState*>(pRng)->FillForMbedtls(output, outputLen);
  }

 private:
  int FillForMbedtls(unsigned char* output, size_t outputLen) noexcept {
    if (outputLen == 0) {
      return 0;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    if (!EnsureSeededLocked().ok()) {
      return MBEDTLS_ERR_CTR_DRBG_ENTROPY_SOURCE_FAILED;
    }

    size_t offset = 0;
    while (offset < outputLen) {
      const size_t chunk = std::min(
          outputLen - offset,
          static_cast<size_t>(MBEDTLS_CTR_DRBG_MAX_REQUEST));
      const int rc = mbedtls_ctr_drbg_random(&ctrDrbg_, output + offset, chunk);
      if (rc != 0) {
        return rc;
      }
      offset += chunk;
    }
    return 0;
  }

  Status EnsureSeededLocked() noexcept {
    if (seeded_) {
      return OkStatus();
    }
    const int rc = mbedtls_ctr_drbg_seed(
        &ctrDrbg_,
        mbedtls_entropy_func,
        &entropy_,
        reinterpret_cast<const unsigned char*>(kRandomPersonalization),
        sizeof(kRandomPersonalization) - 1);
    if (rc != 0) {
      return Status::Unavailable();
    }
    seeded_ = true;
    return OkStatus();
  }

  mbedtls_entropy_context entropy_{};
  mbedtls_ctr_drbg_context ctrDrbg_{};
  std::mutex mutex_;
  bool seeded_{false};
};

RandomState& GlobalRandomState() noexcept {
  static RandomState state;
  return state;
}

class X25519Ctx {
 public:
  X25519Ctx() noexcept {
    mbedtls_ecp_group_init(&group_);
    mbedtls_mpi_init(&privateScalar_);
    mbedtls_ecp_point_init(&publicPoint_);
    mbedtls_ecp_point_init(&sharedPoint_);
  }

  ~X25519Ctx() noexcept {
    mbedtls_ecp_point_free(&sharedPoint_);
    mbedtls_ecp_point_free(&publicPoint_);
    mbedtls_mpi_free(&privateScalar_);
    mbedtls_ecp_group_free(&group_);
  }

  X25519Ctx(const X25519Ctx&) = delete;
  X25519Ctx& operator=(const X25519Ctx&) = delete;
  X25519Ctx(X25519Ctx&&) = delete;
  X25519Ctx& operator=(X25519Ctx&&) = delete;

  Status Setup() noexcept {
    if (mbedtls_ecp_group_load(&group_, MBEDTLS_ECP_DP_CURVE25519) != 0) {
      return Status::Internal();
    }
    return OkStatus();
  }

  mbedtls_ecp_group& group() noexcept {
    return group_;
  }

  mbedtls_mpi& privateScalar() noexcept {
    return privateScalar_;
  }

  mbedtls_ecp_point& publicPoint() noexcept {
    return publicPoint_;
  }

  mbedtls_ecp_point& sharedPoint() noexcept {
    return sharedPoint_;
  }

 private:
  mbedtls_ecp_group group_;
  mbedtls_mpi privateScalar_;
  mbedtls_ecp_point publicPoint_;
  mbedtls_ecp_point sharedPoint_;
};

Status LoadClampedPrivateScalar(
    X25519Ctx& ctx,
    ConstByteSpan privateKey32) noexcept {
  std::array<uint8_t, CryptoBackend::kX25519KeySize> clamped{};
  std::copy_n(privateKey32.data(), clamped.size(), clamped.data());
  clamped[0] &= kX25519LowByteClampMask;
  clamped[31] &= kX25519HighByteClearMask;
  clamped[31] |= kX25519HighByteSetMask;

  const int rc = mbedtls_mpi_read_binary_le(
      &ctx.privateScalar(), clamped.data(), clamped.size());
  SecureZeroize(clamped);
  if (rc != 0) {
    return Status::Internal();
  }
  return OkStatus();
}

Status ComputePublicPoint(X25519Ctx& ctx) noexcept {
  RandomState& rng = GlobalRandomState();
  if (mbedtls_ecp_mul(
          &ctx.group(),
          &ctx.publicPoint(),
          &ctx.privateScalar(),
          &ctx.group().G,
          &RandomState::Callback,
          &rng) != 0) {
    return Status::Internal();
  }
  return OkStatus();
}

Status WritePublicKey(
    mbedtls_ecp_group& group,
    const mbedtls_ecp_point& point,
    ByteSpan out32) noexcept {
  size_t written = 0;
  if (mbedtls_ecp_point_write_binary(
          &group,
          &point,
          MBEDTLS_ECP_PF_UNCOMPRESSED,
          &written,
          out32.data(),
          out32.size()) != 0 ||
      written != CryptoBackend::kX25519KeySize) {
    return Status::Internal();
  }
  return OkStatus();
}

Status ReadAndValidatePeerPublicKey(
    mbedtls_ecp_group& group,
    ConstByteSpan peerPublic32,
    mbedtls_ecp_point& peerPoint) noexcept {
  if (mbedtls_ecp_point_read_binary(
          &group, &peerPoint, peerPublic32.data(), peerPublic32.size()) != 0) {
    return Status::InvalidArgument();
  }
  if (mbedtls_ecp_check_pubkey(&group, &peerPoint) != 0) {
    return Status::InvalidArgument();
  }
  return OkStatus();
}

bool IsAllZero(ConstByteSpan bytes) noexcept {
  uint8_t anyBitsSet = 0;
  for (size_t i = 0; i < bytes.size(); ++i) {
    anyBitsSet = static_cast<uint8_t>(anyBitsSet | bytes[i]);
  }
  return anyBitsSet == 0;
}

const unsigned char* MbedtlsData(ConstByteSpan bytes) noexcept {
  return bytes.empty() ? nullptr : bytes.data();
}

unsigned char* MbedtlsData(ByteSpan bytes) noexcept {
  return bytes.empty() ? nullptr : bytes.data();
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

} // namespace

Status MbedtlsCryptoBackend::Random(ByteSpan out) noexcept {
  return GlobalRandomState().Fill(out);
}

Status MbedtlsCryptoBackend::X25519GenerateKeypair(
    ByteSpan privateKey32,
    ByteSpan publicKey32) noexcept {
  if (!HasExactOutputSize(privateKey32, kX25519KeySize) ||
      !HasExactOutputSize(publicKey32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }

  X25519Ctx ctx;
  Status status = ctx.Setup();
  if (!status.ok()) {
    return status;
  }

  RandomState& rng = GlobalRandomState();
  if (mbedtls_ecp_gen_keypair(
          &ctx.group(),
          &ctx.privateScalar(),
          &ctx.publicPoint(),
          &RandomState::Callback,
          &rng) != 0) {
    return Status::Internal();
  }

  std::array<uint8_t, kX25519KeySize> privateKey{};
  std::array<uint8_t, kX25519KeySize> publicKey{};
  if (mbedtls_mpi_write_binary_le(
          &ctx.privateScalar(), privateKey.data(), privateKey.size()) != 0) {
    SecureZeroize(privateKey);
    return Status::Internal();
  }
  status = WritePublicKey(ctx.group(), ctx.publicPoint(), ByteSpan(publicKey));
  if (!status.ok()) {
    SecureZeroize(privateKey);
    return status;
  }

  std::copy(privateKey.begin(), privateKey.end(), privateKey32.data());
  std::copy(publicKey.begin(), publicKey.end(), publicKey32.data());
  SecureZeroize(privateKey);
  return OkStatus();
}

Status MbedtlsCryptoBackend::X25519PublicFromPrivate(
    ConstByteSpan privateKey32,
    ByteSpan publicKey32) noexcept {
  if (!HasExactInputSize(privateKey32, kX25519KeySize) ||
      !HasExactOutputSize(publicKey32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }

  X25519Ctx ctx;
  Status status = ctx.Setup();
  if (!status.ok()) {
    return status;
  }
  status = LoadClampedPrivateScalar(ctx, privateKey32);
  if (!status.ok()) {
    return status;
  }
  status = ComputePublicPoint(ctx);
  if (!status.ok()) {
    return status;
  }

  std::array<uint8_t, kX25519KeySize> publicKey{};
  status = WritePublicKey(ctx.group(), ctx.publicPoint(), ByteSpan(publicKey));
  if (!status.ok()) {
    return status;
  }
  std::copy(publicKey.begin(), publicKey.end(), publicKey32.data());
  return OkStatus();
}

Status MbedtlsCryptoBackend::X25519Dh(
    ConstByteSpan privateKey32,
    ConstByteSpan peerPublic32,
    ByteSpan sharedSecret32) noexcept {
  if (!HasExactInputSize(privateKey32, kX25519KeySize) ||
      !HasExactInputSize(peerPublic32, kX25519KeySize) ||
      !HasExactOutputSize(sharedSecret32, kX25519KeySize)) {
    return Status::InvalidArgument();
  }

  X25519Ctx ctx;
  Status status = ctx.Setup();
  if (!status.ok()) {
    return status;
  }
  status = LoadClampedPrivateScalar(ctx, privateKey32);
  if (!status.ok()) {
    return status;
  }

  mbedtls_ecp_point peerPoint;
  mbedtls_ecp_point_init(&peerPoint);
  std::array<uint8_t, kX25519KeySize> shared{};
  status = Status::Internal();
  do {
    status = ReadAndValidatePeerPublicKey(ctx.group(), peerPublic32, peerPoint);
    if (!status.ok()) {
      break;
    }
    RandomState& rng = GlobalRandomState();
    if (mbedtls_ecp_mul(
            &ctx.group(),
            &ctx.sharedPoint(),
            &ctx.privateScalar(),
            &peerPoint,
            &RandomState::Callback,
            &rng) != 0) {
      status = Status::Internal();
      break;
    }
    status = WritePublicKey(ctx.group(), ctx.sharedPoint(), ByteSpan(shared));
    if (!status.ok()) {
      break;
    }
    if (IsAllZero(ConstByteSpan(shared))) {
      status = Status::InvalidArgument();
      break;
    }
    std::copy(shared.begin(), shared.end(), sharedSecret32.data());
    status = OkStatus();
  } while (false);

  SecureZeroize(shared);
  mbedtls_ecp_point_free(&peerPoint);
  return status;
}

Status MbedtlsCryptoBackend::Sha256(
    ConstByteSpan data,
    ByteSpan digest32) noexcept {
  if (!IsValidInput(data) || !HasExactOutputSize(digest32, kSha256DigestSize)) {
    return Status::InvalidArgument();
  }

  const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (md == nullptr) {
    return Status::Internal();
  }
  if (mbedtls_md(md, MbedtlsData(data), data.size(), digest32.data()) != 0) {
    SecureZeroize(digest32);
    return Status::Internal();
  }
  return OkStatus();
}

Status MbedtlsCryptoBackend::Sha256Concat(
    ConstByteSpan prefix,
    ConstByteSpan suffix,
    ByteSpan digest32) noexcept {
  if (!IsValidInput(prefix) || !IsValidInput(suffix) ||
      !HasExactOutputSize(digest32, kSha256DigestSize)) {
    return Status::InvalidArgument();
  }

  const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (md == nullptr) {
    return Status::Internal();
  }

  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  Status status = Status::Internal();
  do {
    if (mbedtls_md_setup(&ctx, md, 0) != 0) {
      break;
    }
    if (mbedtls_md_starts(&ctx) != 0) {
      break;
    }
    if (!prefix.empty() &&
        mbedtls_md_update(&ctx, prefix.data(), prefix.size()) != 0) {
      break;
    }
    if (!suffix.empty() &&
        mbedtls_md_update(&ctx, suffix.data(), suffix.size()) != 0) {
      break;
    }
    if (mbedtls_md_finish(&ctx, digest32.data()) != 0) {
      break;
    }
    status = OkStatus();
  } while (false);

  mbedtls_md_free(&ctx);
  if (!status.ok()) {
    SecureZeroize(digest32);
  }
  return status;
}

Status MbedtlsCryptoBackend::HkdfSha256(
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

  const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (md == nullptr) {
    return Status::Internal();
  }

  std::array<uint8_t, kSha256DigestSize * kMaxHkdfSha256Outputs> okm{};
  const size_t okmLen = outputs.size() * kSha256DigestSize;
  if (mbedtls_hkdf(
          md,
          MbedtlsData(salt),
          salt.size(),
          MbedtlsData(ikm),
          ikm.size(),
          MbedtlsData(info),
          info.size(),
          okm.data(),
          okmLen) != 0) {
    SecureZeroize(okm);
    return Status::Internal();
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

Status MbedtlsCryptoBackend::Aes256GcmSeal(
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

  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  status = Status::Internal();
  do {
    if (mbedtls_gcm_setkey(
            &ctx, MBEDTLS_CIPHER_ID_AES, key32.data(), kAes256GcmKeyBits) !=
        0) {
      break;
    }
    if (mbedtls_gcm_crypt_and_tag(
            &ctx,
            MBEDTLS_GCM_ENCRYPT,
            plaintext.size(),
            nonce12.data(),
            nonce12.size(),
            MbedtlsData(aad),
            aad.size(),
            MbedtlsData(plaintext),
            ciphertextAndTagOut.data(),
            kAes256GcmTagSize,
            ciphertextAndTagOut.data() + plaintext.size()) != 0) {
      break;
    }
    status = OkStatus();
  } while (false);

  mbedtls_gcm_free(&ctx);
  if (!status.ok()) {
    SecureZeroize(ciphertextAndTagOut);
  }
  return status;
}

Status MbedtlsCryptoBackend::Aes256GcmOpen(
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

  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  status = Status::Internal();
  do {
    if (mbedtls_gcm_setkey(
            &ctx, MBEDTLS_CIPHER_ID_AES, key32.data(), kAes256GcmKeyBits) !=
        0) {
      break;
    }
    const int rc = mbedtls_gcm_auth_decrypt(
        &ctx,
        plaintextLen,
        nonce12.data(),
        nonce12.size(),
        MbedtlsData(aad),
        aad.size(),
        ciphertextAndTag.data() + plaintextLen,
        kAes256GcmTagSize,
        plaintextLen == 0 ? nullptr : ciphertextAndTag.data(),
        MbedtlsData(plaintextOut));
    if (rc == MBEDTLS_ERR_GCM_AUTH_FAILED) {
      status = Status::Unauthenticated();
      break;
    }
    if (rc != 0) {
      status = Status::Internal();
      break;
    }
    status = OkStatus();
  } while (false);

  mbedtls_gcm_free(&ctx);
  if (!status.ok()) {
    SecureZeroize(plaintextOut);
  }
  return status;
}

} // namespace musegadgets::noise::core
