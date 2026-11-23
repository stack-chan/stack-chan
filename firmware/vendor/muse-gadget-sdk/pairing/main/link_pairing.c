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

#include "link_pairing.h"

#include <ctype.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS
#include "mbedtls/base64.h"
#include "mbedtls/bignum.h"
#include "mbedtls/ecp.h"
#include "mbedtls/md.h"
#include "mbedtls/private/gcm.h"
#include "mbedtls/platform_util.h"

#include "psa/crypto.h"
#include "psa_crypto_driver_esp_ecdsa.h"
#include "psa_crypto_driver_esp_ecdsa_contexts.h"

#include "esp_efuse.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "pairing_signer_policy.h"
#include "pairing_transcript.h"

static const char *TAG = "link.pairing";

#define PAIRING_RECORD_LABEL "hatch-link ble setup v1"
#define PAIRING_TIMEOUT_US (120LL * 1000000LL)
#define PAIRING_PROVISIONING_TIMEOUT_US (120LL * 1000000LL)
#define PAIRING_CLIENT_FINISHED_TIMEOUT_US (60LL * 1000000LL)
#define PAIRING_CONFIRM_TIMEOUT_US (PAIRING_CONFIRM_TIMEOUT_SECONDS * 1000000LL)

#define P256_POINT_BYTES 65
#define NONCE_BYTES 16
#define HASH_BYTES 32
#define KEY_BYTES 32
#define SESSION_ID_BYTES 16
#define GCM_NONCE_BYTES 12
#define GCM_TAG_BYTES 16
#define PAIRING_SIG_BYTES 64

typedef enum {
    PAIRING_IDLE = 0,
    PAIRING_WAIT_CLIENT_FINISHED,
    PAIRING_CONFIRM_REQUIRED,
    PAIRING_READY,
    PAIRING_PROVISIONING,
} pairing_state_t;

static SemaphoreHandle_t s_lock;
static pairing_state_t s_state = PAIRING_IDLE;
static uint32_t s_generation;
static uint32_t s_crypto_generation;
static bool s_confirmation_armed;
static bool s_initialized;
static pairing_signer_t s_signer = PAIRING_SIGNER_UNRESOLVED;

static const char *s_node_id = "";
// Borrowed like the other identity strings: set once before BLE starts and
// pointing at static storage (the CONFIG_GADGET_SDK_TOKEN literal).
static const char *s_sdk_token;
static const char *s_device_id = "";
static const char *s_mac = "";
static const char *s_firmware_version = "";

static mbedtls_ecp_group s_group;
static mbedtls_mpi s_device_priv;
static mbedtls_ecp_point s_device_pub_point;

static uint8_t s_mobile_pub[P256_POINT_BYTES];
static uint8_t s_device_pub[P256_POINT_BYTES];
static uint8_t s_mobile_nonce[NONCE_BYTES];
static uint8_t s_device_nonce[NONCE_BYTES];
static uint8_t s_transcript_hash[HASH_BYTES];
static uint8_t s_session_id[SESSION_ID_BYTES];
static uint8_t s_rx_key[KEY_BYTES];
static uint8_t s_tx_key[KEY_BYTES];

static char s_mobile_pub_b64[96];
static char s_device_pub_b64[96];
static char s_mobile_nonce_b64[32];
static char s_device_nonce_b64[32];
static char s_transcript_hash_b64[48];
static char s_session_id_b64[32];
static char s_device_proof_b64[96];

static int64_t s_deadline_us;
static uint64_t s_rx_counter;
static uint64_t s_tx_counter;

static int rng_cb(void *ctx, unsigned char *out, size_t len) {
    (void)ctx;
    esp_fill_random(out, len);
    return 0;
}

static void lock_take(void) {
    if (s_lock) xSemaphoreTake(s_lock, portMAX_DELAY);
}

static void lock_give(void) {
    if (s_lock) xSemaphoreGive(s_lock);
}

static void clear_session_locked(void) {
    mbedtls_mpi_free(&s_device_priv);
    mbedtls_ecp_point_free(&s_device_pub_point);
    mbedtls_mpi_init(&s_device_priv);
    mbedtls_ecp_point_init(&s_device_pub_point);
    mbedtls_platform_zeroize(s_mobile_pub, sizeof(s_mobile_pub));
    mbedtls_platform_zeroize(s_device_pub, sizeof(s_device_pub));
    mbedtls_platform_zeroize(s_mobile_nonce, sizeof(s_mobile_nonce));
    mbedtls_platform_zeroize(s_device_nonce, sizeof(s_device_nonce));
    mbedtls_platform_zeroize(s_transcript_hash, sizeof(s_transcript_hash));
    mbedtls_platform_zeroize(s_session_id, sizeof(s_session_id));
    mbedtls_platform_zeroize(s_rx_key, sizeof(s_rx_key));
    mbedtls_platform_zeroize(s_tx_key, sizeof(s_tx_key));
    memset(s_mobile_pub_b64, 0, sizeof(s_mobile_pub_b64));
    memset(s_device_pub_b64, 0, sizeof(s_device_pub_b64));
    memset(s_mobile_nonce_b64, 0, sizeof(s_mobile_nonce_b64));
    memset(s_device_nonce_b64, 0, sizeof(s_device_nonce_b64));
    memset(s_transcript_hash_b64, 0, sizeof(s_transcript_hash_b64));
    memset(s_session_id_b64, 0, sizeof(s_session_id_b64));
    memset(s_device_proof_b64, 0, sizeof(s_device_proof_b64));
    s_deadline_us = 0;
    s_rx_counter = 0;
    s_tx_counter = 0;
    s_state = PAIRING_IDLE;
    s_confirmation_armed = false;
}

static void advance_generation_locked(void) {
    // Zero is reserved for callers without a session token.
    if (++s_generation == 0) ++s_generation;
}

static void reset_locked(void) {
    advance_generation_locked();
    s_crypto_generation = s_generation;
    clear_session_locked();
}

uint32_t link_pairing_session_generation(void) {
    lock_take();
    uint32_t generation = s_state != PAIRING_IDLE ? s_generation : 0;
    lock_give();
    return generation;
}

bool link_pairing_session_is_current(uint32_t generation) {
    lock_take();
    bool current = generation != 0 && generation == s_generation;
    lock_give();
    return current;
}

bool link_pairing_record_session_is_current(uint32_t generation) {
    lock_take();
    bool current = generation != 0 && generation == s_crypto_generation;
    lock_give();
    return current;
}

bool link_pairing_reset_session(uint32_t generation) {
    lock_take();
    bool current = generation != 0 && generation == s_generation;
    if (current) reset_locked();
    lock_give();
    return current;
}

void link_pairing_reset(void) {
    lock_take();
    reset_locked();
    lock_give();
}

static bool expired_locked(void) {
    if (s_state == PAIRING_IDLE || s_deadline_us == 0) return false;
    if (esp_timer_get_time() <= s_deadline_us) return false;
    ESP_LOGW(TAG, "pairing session timed out");
    // Clear expired secrets while retaining the token so its timer can close
    // this connection. An explicit reset or another hello invalidates it.
    clear_session_locked();
    return true;
}

static bool session_keys_available_locked(void) {
    return s_state == PAIRING_WAIT_CLIENT_FINISHED
           || s_state == PAIRING_CONFIRM_REQUIRED
           || s_state == PAIRING_READY
           || s_state == PAIRING_PROVISIONING;
}

static bool session_confirmed_locked(void) {
    return s_state == PAIRING_READY || s_state == PAIRING_PROVISIONING;
}

static const mbedtls_md_info_t *sha256_info(void) {
    return mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
}

static bool sha256_bytes(const uint8_t *data, size_t len, uint8_t out[HASH_BYTES]) {
    const mbedtls_md_info_t *md = sha256_info();
    return md && mbedtls_md(md, data, len, out) == 0;
}

static bool hmac_sha256(const uint8_t *key, size_t key_len,
                        const uint8_t *data, size_t data_len,
                        uint8_t out[HASH_BYTES]) {
    const mbedtls_md_info_t *md = sha256_info();
    return md && mbedtls_md_hmac(md, key, key_len, data, data_len, out) == 0;
}

static bool hkdf32(const uint8_t *ikm, size_t ikm_len,
                   const uint8_t *salt, size_t salt_len,
                   const uint8_t *info, size_t info_len,
                   uint8_t out[KEY_BYTES]) {
    uint8_t prk[HASH_BYTES];
    uint8_t block[HASH_BYTES + 128 + 1];
    if (info_len > 128) return false;
    if (!hmac_sha256(salt, salt_len, ikm, ikm_len, prk)) return false;
    memcpy(block, info, info_len);
    block[info_len] = 1;
    bool ok = hmac_sha256(prk, sizeof(prk), block, info_len + 1, out);
    mbedtls_platform_zeroize(prk, sizeof(prk));
    mbedtls_platform_zeroize(block, sizeof(block));
    return ok;
}

static bool hkdf_expand32(const uint8_t prk[KEY_BYTES],
                          const uint8_t *info, size_t info_len,
                          uint8_t out[KEY_BYTES]) {
    uint8_t block[128 + 1];
    if (info_len > 128) return false;
    memcpy(block, info, info_len);
    block[info_len] = 1;
    bool ok = hmac_sha256(prk, KEY_BYTES, block, info_len + 1, out);
    mbedtls_platform_zeroize(block, sizeof(block));
    return ok;
}

static bool base64url_encode(const uint8_t *data, size_t len, char *out, size_t out_cap) {
    size_t need = 0;
    mbedtls_base64_encode(NULL, 0, &need, data, len);
    char *tmp = calloc(1, need + 1);
    if (!tmp) return false;
    size_t olen = 0;
    int rc = mbedtls_base64_encode((uint8_t *)tmp, need + 1, &olen, data, len);
    if (rc != 0) {
        free(tmp);
        return false;
    }
    while (olen > 0 && tmp[olen - 1] == '=') olen--;
    if (olen + 1 > out_cap) {
        free(tmp);
        return false;
    }
    for (size_t i = 0; i < olen; i++) {
        out[i] = (tmp[i] == '+') ? '-' : (tmp[i] == '/') ? '_' : tmp[i];
    }
    out[olen] = '\0';
    free(tmp);
    return true;
}

static bool base64url_decode(const char *in, uint8_t *out, size_t out_cap, size_t *out_len) {
    if (!in || !out || !out_len) return false;
    size_t n = strlen(in);
    if (n == 0 || n > 4096 || (n % 4) == 1) return false;
    size_t padded = n + ((4 - (n % 4)) % 4);
    char *tmp = malloc(padded + 1);
    if (!tmp) return false;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)in[i];
        if (c == '-') c = '+';
        else if (c == '_') c = '/';
        else if (!isalnum(c)) {
            free(tmp);
            return false;
        }
        tmp[i] = (char)c;
    }
    for (size_t i = n; i < padded; i++) tmp[i] = '=';
    tmp[padded] = '\0';
    size_t olen = 0;
    int rc = mbedtls_base64_decode(out, out_cap, &olen, (const uint8_t *)tmp, padded);
    free(tmp);
    if (rc != 0) return false;
    *out_len = olen;
    return true;
}

static bool json_string(cJSON *root, const char *key, const char **out) {
    cJSON *item = cJSON_GetObjectItem(root, key);
    if (!cJSON_IsString(item) || !item->valuestring || !*item->valuestring) {
        return false;
    }
    *out = item->valuestring;
    return true;
}

static bool parse_u64_decimal(const char *s, uint64_t *out) {
    if (!s || !*s || !out) return false;
    uint64_t value = 0;
    for (const char *p = s; *p; p++) {
        if (*p < '0' || *p > '9') return false;
        uint64_t digit = (uint64_t)(*p - '0');
        if (value > (UINT64_MAX - digit) / 10) return false;
        value = value * 10 + digit;
    }
    *out = value;
    return true;
}

static pairing_signer_t resolve_pairing_signer(void) {
#if !defined(CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH)
    ESP_LOGI(TAG, "community pairing: no manufacturer attestation");
    return PAIRING_SIGNER_COMMUNITY;
#else
    int configured_block = CONFIG_HOMEHUB_PAIRING_ECDSA_EFUSE_BLOCK;
    if (configured_block < EFUSE_BLK_KEY0
        || configured_block >= EFUSE_BLK_KEY_MAX) {
        ESP_LOGE(TAG, "pairing eFuse block %d is outside the key-block range",
                 configured_block);
        return PAIRING_SIGNER_UNAVAILABLE;
    }

    esp_efuse_block_t block = (esp_efuse_block_t)configured_block;
    bool block_unused = esp_efuse_key_block_unused(block);
    esp_efuse_purpose_t purpose = esp_efuse_get_key_purpose(block);
    bool read_protected = esp_efuse_get_key_dis_read(block);
    bool write_protected = esp_efuse_get_key_dis_write(block);
    bool purpose_locked = esp_efuse_get_keypurpose_dis_write(block);
    pairing_signer_t signer = pairing_signer_classify(
        block_unused, purpose == ESP_EFUSE_KEY_PURPOSE_ECDSA_KEY,
        read_protected, write_protected, purpose_locked);

    if (signer == PAIRING_SIGNER_COMMUNITY) {
        ESP_LOGW(TAG, "pairing eFuse block %d is completely unused; "
                      "community pairing only", configured_block);
    } else if (signer == PAIRING_SIGNER_EFUSE) {
        ESP_LOGI(TAG, "pairing signer: protected eFuse block %d (production epoch %d)",
                 configured_block, CONFIG_HOMEHUB_PAIRING_AUTH_EPOCH);
    } else {
        ESP_LOGE(TAG, "pairing eFuse block %d is neither unused nor a fully protected "
                      "ECDSA key (purpose=%d read=%d write=%d purpose_lock=%d); "
                      "refusing community fallback",
                 configured_block, (int)purpose, read_protected, write_protected,
                 purpose_locked);
    }
    return signer;
#endif
}

static pairing_signer_t pairing_signer(void) {
    if (s_signer == PAIRING_SIGNER_UNRESOLVED) {
        s_signer = resolve_pairing_signer();
    }
    return s_signer;
}

static int pairing_auth_epoch(void) {
    switch (pairing_signer()) {
        case PAIRING_SIGNER_COMMUNITY:
            return 0;
        case PAIRING_SIGNER_EFUSE:
            return CONFIG_HOMEHUB_PAIRING_AUTH_EPOCH;
        case PAIRING_SIGNER_UNRESOLVED:
        case PAIRING_SIGNER_UNAVAILABLE:
        default:
            return 0;
    }
}

static bool pairing_is_community(void) {
    return pairing_signer() == PAIRING_SIGNER_COMMUNITY;
}

static const char *pairing_auth(void) {
    return pairing_is_community() ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH;
}

static char *make_transcript(void) {
    const pairing_transcript_fields_t fields = {
        .device_id = s_device_id,
        .node_id = s_node_id,
        .mac = s_mac,
        .firmware_version = s_firmware_version,
        .mobile_pub = s_mobile_pub_b64,
        .device_pub = s_device_pub_b64,
        .mobile_nonce = s_mobile_nonce_b64,
        .device_nonce = s_device_nonce_b64,
    };
    return pairing_transcript_build(pairing_is_community(), pairing_auth_epoch(),
                                    PAIRING_POLICY_BUTTON, &fields);
}

#if defined(CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH) && defined(ESP_ECDSA_DRIVER_ENABLED)
// Call only after pairing_signer() selects the fully protected eFuse state.
static bool hardware_sign_hash(const uint8_t hash[HASH_BYTES],
                               uint8_t out_sig[PAIRING_SIG_BYTES]) {
    if (psa_crypto_init() != PSA_SUCCESS) {
        ESP_LOGE(TAG, "psa_crypto_init failed");
        return false;
    }

    esp_ecdsa_opaque_key_t opaque_key = {0};
    opaque_key.curve = ESP_ECDSA_CURVE_SECP256R1;
    opaque_key.efuse_block = (uint8_t)CONFIG_HOMEHUB_PAIRING_ECDSA_EFUSE_BLOCK;

    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(&attr, 256);
    psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_HASH);
    psa_set_key_algorithm(&attr, PSA_ALG_DETERMINISTIC_ECDSA(PSA_ALG_SHA_256));
    psa_set_key_lifetime(&attr, PSA_KEY_LIFETIME_ESP_ECDSA_VOLATILE);

    psa_key_id_t key_id = 0;
    psa_status_t st = psa_import_key(&attr, (const uint8_t *)&opaque_key,
                                     sizeof(opaque_key), &key_id);
    if (st != PSA_SUCCESS) {
        ESP_LOGE(TAG, "eFuse ECDSA key import failed: %d", (int)st);
        return false;
    }

    // Sign twice and require byte-identical output. The fleet scalar is shared
    // across every unit, so a randomized (non-RFC-6979) nonce would risk
    // exposing it, and a successful sign alone cannot prove determinism. Two
    // identical deterministic signatures over the same hash confirm the
    // peripheral really is in deterministic mode; if they differ (or either
    // sign fails) we fail closed and never emit a proof, rather than risk the
    // shared key. Signatures are public, so a plain memcmp is fine.
    size_t sig_len = 0;
    size_t sig_len2 = 0;
    uint8_t sig2[PAIRING_SIG_BYTES];
    st = psa_sign_hash(key_id, PSA_ALG_DETERMINISTIC_ECDSA(PSA_ALG_SHA_256),
                       hash, HASH_BYTES,
                       out_sig, PAIRING_SIG_BYTES, &sig_len);
    psa_status_t st2 = psa_sign_hash(key_id,
                                     PSA_ALG_DETERMINISTIC_ECDSA(PSA_ALG_SHA_256),
                                     hash, HASH_BYTES,
                                     sig2, PAIRING_SIG_BYTES, &sig_len2);
    psa_destroy_key(key_id);
    bool ok = st == PSA_SUCCESS && st2 == PSA_SUCCESS
              && sig_len == PAIRING_SIG_BYTES && sig_len2 == PAIRING_SIG_BYTES
              && memcmp(out_sig, sig2, PAIRING_SIG_BYTES) == 0;
    mbedtls_platform_zeroize(sig2, sizeof(sig2));
    if (!ok) {
        ESP_LOGE(TAG, "eFuse ECDSA sign failed or non-deterministic "
                      "(st=%d st2=%d)", (int)st, (int)st2);
        mbedtls_platform_zeroize(out_sig, PAIRING_SIG_BYTES);
        return false;
    }
    return true;
}
#endif

// Only a protected manufacturer key signs an official v5 transcript. Signing
// errors never select community authentication; the mode is fixed before hello.
static bool sign_transcript_ecdsa(uint8_t out_sig[PAIRING_SIG_BYTES]) {
    if (pairing_signer() != PAIRING_SIGNER_EFUSE) return false;
#if defined(CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH) && defined(ESP_ECDSA_DRIVER_ENABLED)
    return hardware_sign_hash(s_transcript_hash, out_sig);
#else
    (void)out_sig;
    ESP_LOGE(TAG, "hardware ECDSA sign not enabled");
    return false;
#endif
}

const char *link_pairing_sign_factory_test(void) {
#if !defined(ESP_ECDSA_DRIVER_ENABLED)
    return "NO FUSE DRIVER";
#elif !defined(CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH)
    return "NO MANUFACTURER ATTESTATION";
#else
    pairing_signer_t signer = pairing_signer();
    if (signer == PAIRING_SIGNER_COMMUNITY) {
        return "EMPTY FUSE";
    }
    if (signer != PAIRING_SIGNER_EFUSE) {
        return "INVALID FUSE";
    }

    uint8_t hash[HASH_BYTES];
    uint8_t sig[PAIRING_SIG_BYTES];
    if (!sha256_bytes((const uint8_t *)"FACTORY-TEST", 12, hash)
        || !hardware_sign_hash(hash, sig)) {
        mbedtls_platform_zeroize(hash, sizeof(hash));
        mbedtls_platform_zeroize(sig, sizeof(sig));
        return "SIGN FAILED";
    }

    static char hex[PAIRING_SIG_BYTES * 2 + 1];
    for (size_t i = 0; i < PAIRING_SIG_BYTES; i++)
        snprintf(hex + i * 2, 3, "%02x", sig[i]);
    mbedtls_platform_zeroize(hash, sizeof(hash));
    mbedtls_platform_zeroize(sig, sizeof(sig));
    return hex;
#endif
}

static bool build_aad(uint8_t direction, uint64_t counter,
                      char *out, size_t out_cap) {
    const char *dir = direction == 0 ? "m2d" : "d2m";
    int n = snprintf(out, out_cap, "%s|%s|%s|%" PRIu64,
                     PAIRING_RECORD_LABEL, s_session_id_b64, dir, counter);
    return n > 0 && n < (int)out_cap;
}

static void build_nonce(uint8_t direction, uint64_t counter, uint8_t out[GCM_NONCE_BYTES]) {
    memset(out, 0, GCM_NONCE_BYTES);
    out[0] = direction;
    for (int i = 0; i < 8; i++) {
        out[11 - i] = (uint8_t)(counter & 0xff);
        counter >>= 8;
    }
}

static bool aes_gcm_encrypt(const uint8_t *key, const uint8_t *plain, size_t plain_len,
                            uint8_t direction, uint64_t counter,
                            uint8_t *cipher, uint8_t tag[GCM_TAG_BYTES]) {
    uint8_t nonce[GCM_NONCE_BYTES];
    char aad[128];
    build_nonce(direction, counter, nonce);
    if (!build_aad(direction, counter, aad, sizeof(aad))) return false;
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    int rc = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, KEY_BYTES * 8);
    if (rc == 0) {
        rc = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, plain_len,
                                       nonce, sizeof(nonce),
                                       (const uint8_t *)aad, strlen(aad),
                                       plain, cipher, GCM_TAG_BYTES, tag);
    }
    mbedtls_gcm_free(&gcm);
    return rc == 0;
}

static bool aes_gcm_decrypt(const uint8_t *key, const uint8_t *cipher, size_t cipher_len,
                            const uint8_t tag[GCM_TAG_BYTES],
                            uint8_t direction, uint64_t counter,
                            uint8_t *plain) {
    uint8_t nonce[GCM_NONCE_BYTES];
    char aad[128];
    build_nonce(direction, counter, nonce);
    if (!build_aad(direction, counter, aad, sizeof(aad))) return false;
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    int rc = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, KEY_BYTES * 8);
    if (rc == 0) {
        rc = mbedtls_gcm_auth_decrypt(&gcm, cipher_len, nonce, sizeof(nonce),
                                      (const uint8_t *)aad, strlen(aad),
                                      tag, GCM_TAG_BYTES, cipher, plain);
    }
    mbedtls_gcm_free(&gcm);
    return rc == 0;
}

static char *make_envelope(const char *kind, uint64_t counter,
                           const uint8_t *cipher, size_t cipher_len,
                           const uint8_t tag[GCM_TAG_BYTES]) {
    char *cipher_b64 = malloc(((cipher_len + 2) / 3) * 4 + 1);
    char tag_b64[32];
    if (!cipher_b64) return NULL;
    if (!base64url_encode(cipher, cipher_len, cipher_b64,
                          ((cipher_len + 2) / 3) * 4 + 1)
        || !base64url_encode(tag, GCM_TAG_BYTES, tag_b64, sizeof(tag_b64))) {
        free(cipher_b64);
        return NULL;
    }
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        free(cipher_b64);
        return NULL;
    }
    cJSON_AddStringToObject(root, kind, "pairing_encrypted");
    cJSON_AddStringToObject(root, "session_id", s_session_id_b64);
    char counter_str[21];
    snprintf(counter_str, sizeof(counter_str), "%" PRIu64, counter);
    cJSON_AddStringToObject(root, "counter", counter_str);
    cJSON_AddStringToObject(root, "ciphertext", cipher_b64);
    cJSON_AddStringToObject(root, "tag", tag_b64);
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    free(cipher_b64);
    return json;
}

static bool derive_session_keys(void) {
    mbedtls_ecp_point peer;
    mbedtls_ecp_point shared;
    mbedtls_ecp_point_init(&peer);
    mbedtls_ecp_point_init(&shared);
    int rc = mbedtls_ecp_point_read_binary(&s_group, &peer,
                                           s_mobile_pub, sizeof(s_mobile_pub));
    if (rc == 0) rc = mbedtls_ecp_check_pubkey(&s_group, &peer);
    if (rc == 0) rc = mbedtls_ecp_mul(&s_group, &shared, &s_device_priv,
                                      &peer, rng_cb, NULL);

    uint8_t ecdh[KEY_BYTES];
    if (rc == 0) {
        rc = mbedtls_mpi_write_binary(&shared.MBEDTLS_PRIVATE(X),
                                      ecdh, sizeof(ecdh));
    }
    mbedtls_ecp_point_free(&peer);
    mbedtls_ecp_point_free(&shared);
    if (rc != 0) return false;

    uint8_t salt_input[NONCE_BYTES * 2 + HASH_BYTES];
    memcpy(salt_input, s_mobile_nonce, NONCE_BYTES);
    memcpy(salt_input + NONCE_BYTES, s_device_nonce, NONCE_BYTES);
    memcpy(salt_input + NONCE_BYTES * 2, s_transcript_hash, HASH_BYTES);
    uint8_t salt[HASH_BYTES];
    uint8_t session_secret[KEY_BYTES];
    bool ok = sha256_bytes(salt_input, sizeof(salt_input), salt)
              && hkdf32(ecdh, sizeof(ecdh), salt, sizeof(salt),
                        (const uint8_t *)PAIRING_RECORD_LABEL,
                        strlen(PAIRING_RECORD_LABEL), session_secret)
              && hkdf_expand32(session_secret,
                               (const uint8_t *)"mobile->device",
                               strlen("mobile->device"), s_rx_key)
              && hkdf_expand32(session_secret,
                               (const uint8_t *)"device->mobile",
                               strlen("device->mobile"), s_tx_key);

    uint8_t sid_input[sizeof("hatch-link session id v1") - 1 + HASH_BYTES + KEY_BYTES];
    uint8_t sid_hash[HASH_BYTES];
    if (ok) {
        memcpy(sid_input, "hatch-link session id v1",
               sizeof("hatch-link session id v1") - 1);
        memcpy(sid_input + sizeof("hatch-link session id v1") - 1,
               s_transcript_hash, HASH_BYTES);
        memcpy(sid_input + sizeof("hatch-link session id v1") - 1 + HASH_BYTES,
               ecdh, KEY_BYTES);
        ok = sha256_bytes(sid_input, sizeof(sid_input), sid_hash);
        if (ok) {
            memcpy(s_session_id, sid_hash, SESSION_ID_BYTES);
            ok = base64url_encode(s_session_id, SESSION_ID_BYTES,
                                  s_session_id_b64, sizeof(s_session_id_b64));
        }
    }

    mbedtls_platform_zeroize(ecdh, sizeof(ecdh));
    mbedtls_platform_zeroize(salt_input, sizeof(salt_input));
    mbedtls_platform_zeroize(salt, sizeof(salt));
    mbedtls_platform_zeroize(session_secret, sizeof(session_secret));
    mbedtls_platform_zeroize(sid_input, sizeof(sid_input));
    mbedtls_platform_zeroize(sid_hash, sizeof(sid_hash));
    return ok;
}

void link_pairing_init(const char *node_id, const char *device_id,
                       const char *mac, const char *firmware_version,
                       const char *sdk_token) {
    if (!s_lock) s_lock = xSemaphoreCreateMutex();
    lock_take();
    s_node_id = node_id ? node_id : "";
    s_device_id = device_id ? device_id : "";
    s_mac = mac ? mac : "";
    s_firmware_version = firmware_version ? firmware_version : "unknown";
    s_sdk_token = sdk_token && *sdk_token ? sdk_token : NULL;
    if (!s_initialized) {
        mbedtls_ecp_group_init(&s_group);
        mbedtls_mpi_init(&s_device_priv);
        mbedtls_ecp_point_init(&s_device_pub_point);
        if (mbedtls_ecp_group_load(&s_group, MBEDTLS_ECP_DP_SECP256R1) != 0) {
            ESP_LOGE(TAG, "P-256 group unavailable");
        }
        s_initialized = true;
    }
    (void)pairing_signer();
    reset_locked();
    lock_give();
}

void link_pairing_add_device_info(cJSON *root) {
    if (!root) return;
    cJSON_AddStringToObject(root, "device_id", s_device_id);
    cJSON_AddStringToObject(root, "mac", s_mac);
    cJSON_AddStringToObject(root, "model", PAIRING_MODEL);
    cJSON_AddNumberToObject(root, "pairing_protocol", PAIRING_VERSION);
    cJSON_AddStringToObject(root, "pairing_auth", pairing_auth());
    cJSON_AddNumberToObject(root, "pairing_auth_epoch",
                            pairing_auth_epoch());
    cJSON_AddStringToObject(root, "pairing_policy", PAIRING_POLICY_BUTTON);
}

bool link_pairing_plaintext_setup_blocked(void) {
    return true;
}

const char *link_pairing_handle_client_hello(cJSON *root, char **response_json) {
    if (response_json) *response_json = NULL;
    const char *mobile_pub_b64 = NULL;
    const char *mobile_nonce_b64 = NULL;
    const char *auth = NULL;
    const char *policy = NULL;
    cJSON *version = cJSON_GetObjectItem(root, "version");
    if (!cJSON_IsNumber(version)
        || version->valuedouble != (double)PAIRING_VERSION
        || !json_string(root, "pairing_auth", &auth)
        || strcmp(auth, pairing_auth()) != 0
        || !json_string(root, "pairing_policy", &policy)
        || strcmp(policy, PAIRING_POLICY_BUTTON) != 0
        || !json_string(root, "mobile_pub", &mobile_pub_b64)
        || !json_string(root, "mobile_nonce", &mobile_nonce_b64)) {
        return "error_pairing_invalid_hello";
    }

    // Every v5 caller explicitly selects the advertised authentication mode.
    // Missing credentials or a failed proof never negotiate another mode.
    lock_take();
    reset_locked();

    if (pairing_signer() == PAIRING_SIGNER_UNAVAILABLE) {
        lock_give();
        return "error_pairing_unavailable";
    }

    size_t len = 0;
    if (!base64url_decode(mobile_pub_b64, s_mobile_pub, sizeof(s_mobile_pub), &len)
        || len != P256_POINT_BYTES || s_mobile_pub[0] != 0x04
        || !base64url_decode(mobile_nonce_b64, s_mobile_nonce, sizeof(s_mobile_nonce), &len)
        || len != NONCE_BYTES) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }

    mbedtls_ecp_point peer;
    mbedtls_ecp_point_init(&peer);
    int rc = mbedtls_ecp_point_read_binary(&s_group, &peer,
                                           s_mobile_pub, sizeof(s_mobile_pub));
    if (rc == 0) rc = mbedtls_ecp_check_pubkey(&s_group, &peer);
    mbedtls_ecp_point_free(&peer);
    if (rc != 0
        || mbedtls_ecp_gen_keypair(&s_group, &s_device_priv,
                                   &s_device_pub_point, rng_cb, NULL) != 0) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }

    size_t pub_len = 0;
    if (mbedtls_ecp_point_write_binary(&s_group, &s_device_pub_point,
                                       MBEDTLS_ECP_PF_UNCOMPRESSED,
                                       &pub_len, s_device_pub,
                                       sizeof(s_device_pub)) != 0
        || pub_len != P256_POINT_BYTES) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }
    esp_fill_random(s_device_nonce, sizeof(s_device_nonce));

    if (!base64url_encode(s_mobile_pub, sizeof(s_mobile_pub),
                          s_mobile_pub_b64, sizeof(s_mobile_pub_b64))
        || !base64url_encode(s_device_pub, sizeof(s_device_pub),
                             s_device_pub_b64, sizeof(s_device_pub_b64))
        || !base64url_encode(s_mobile_nonce, sizeof(s_mobile_nonce),
                             s_mobile_nonce_b64, sizeof(s_mobile_nonce_b64))
        || !base64url_encode(s_device_nonce, sizeof(s_device_nonce),
                             s_device_nonce_b64, sizeof(s_device_nonce_b64))) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }

    char *transcript = make_transcript();
    uint8_t device_sig[PAIRING_SIG_BYTES];
    if (!transcript
        || !sha256_bytes((const uint8_t *)transcript, strlen(transcript),
                         s_transcript_hash)
        || !base64url_encode(s_transcript_hash, sizeof(s_transcript_hash),
                             s_transcript_hash_b64, sizeof(s_transcript_hash_b64))
        || !derive_session_keys()) {
        free(transcript);
        mbedtls_platform_zeroize(device_sig, sizeof(device_sig));
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }
    free(transcript);

    if (!pairing_is_community()
        && (!sign_transcript_ecdsa(device_sig)
            || !base64url_encode(device_sig, sizeof(device_sig),
                                 s_device_proof_b64, sizeof(s_device_proof_b64)))) {
        mbedtls_platform_zeroize(device_sig, sizeof(device_sig));
        reset_locked();
        lock_give();
        return "error_pairing_unavailable";
    }
    mbedtls_platform_zeroize(device_sig, sizeof(device_sig));

    cJSON *reply = cJSON_CreateObject();
    if (!reply) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }
    cJSON_AddStringToObject(reply, "type", "pairing_ready");
    cJSON_AddNumberToObject(reply, "version", PAIRING_VERSION);
    cJSON_AddStringToObject(reply, "device_id", s_device_id);
    cJSON_AddStringToObject(reply, "node_id", s_node_id);
    cJSON_AddStringToObject(reply, "mac", s_mac);
    cJSON_AddStringToObject(reply, "model", PAIRING_MODEL);
    cJSON_AddStringToObject(reply, "firmware_version", s_firmware_version);
    cJSON_AddStringToObject(reply, "pairing_auth", pairing_auth());
    cJSON_AddNumberToObject(reply, "pairing_auth_epoch",
                            pairing_auth_epoch());
    cJSON_AddStringToObject(reply, "pairing_policy", PAIRING_POLICY_BUTTON);
    cJSON_AddStringToObject(reply, "device_pub", s_device_pub_b64);
    cJSON_AddStringToObject(reply, "device_nonce", s_device_nonce_b64);
    cJSON_AddStringToObject(reply, "transcript_hash", s_transcript_hash_b64);
    cJSON_AddStringToObject(reply, "session_id", s_session_id_b64);
    if (!pairing_is_community()) {
        cJSON_AddStringToObject(reply, "device_proof", s_device_proof_b64);
    }
    *response_json = cJSON_PrintUnformatted(reply);
    cJSON_Delete(reply);
    if (!*response_json) {
        reset_locked();
        lock_give();
        return "error_pairing_invalid_hello";
    }
    s_deadline_us = esp_timer_get_time() + PAIRING_CLIENT_FINISHED_TIMEOUT_US;
    s_rx_counter = 0;
    s_tx_counter = 0;
    s_state = PAIRING_WAIT_CLIENT_FINISHED;
    lock_give();
    return NULL;
}

const char *link_pairing_decrypt_command(cJSON *root, char **plaintext_json) {
    return link_pairing_decrypt_diagnostic(root, plaintext_json, NULL);
}

const char *link_pairing_decrypt_diagnostic(cJSON *root, char **plaintext_json,
                                           link_pairing_decrypt_reason_t *reason) {
    if (plaintext_json) *plaintext_json = NULL;
    if (reason) *reason = LINK_DECRYPT_OK;
    lock_take();
    link_pairing_decrypt_reason_t failure = LINK_DECRYPT_OK;
    if (expired_locked()) failure = LINK_DECRYPT_EXPIRED;
    else if (!session_keys_available_locked()) failure = LINK_DECRYPT_STATE;
    const char *session_id = NULL, *counter_str = NULL, *cipher_b64 = NULL, *tag_b64 = NULL;
    uint64_t counter = 0;
    if (!failure) {
        if (!json_string(root, "session_id", &session_id)
            || !json_string(root, "counter", &counter_str)
            || !json_string(root, "ciphertext", &cipher_b64)
            || !json_string(root, "tag", &tag_b64)) failure = LINK_DECRYPT_ENVELOPE;
        else if (strcmp(session_id, s_session_id_b64)) failure = LINK_DECRYPT_SESSION;
        else if (!parse_u64_decimal(counter_str, &counter) || counter != s_rx_counter)
            failure = LINK_DECRYPT_COUNTER;
    }
    if (failure) {
        reset_locked();
        if (reason) *reason = failure;
        lock_give();
        return "error_pairing_decrypt";
    }
    size_t cipher_cap = strlen(cipher_b64) / 4 * 3 + 3;
    uint8_t *cipher = malloc(cipher_cap), *plain = malloc(cipher_cap + 1);
    uint8_t tag[GCM_TAG_BYTES];
    size_t cipher_len = 0, tag_len = 0;
    if (!cipher || !plain) failure = LINK_DECRYPT_MEMORY;
    else if (!base64url_decode(cipher_b64, cipher, cipher_cap, &cipher_len)
             || !base64url_decode(tag_b64, tag, sizeof(tag), &tag_len)
             || tag_len != GCM_TAG_BYTES) failure = LINK_DECRYPT_BASE64;
    else if (!aes_gcm_decrypt(s_rx_key, cipher, cipher_len, tag, 0, s_rx_counter, plain))
        failure = LINK_DECRYPT_AEAD;
    if (!failure) {
        plain[cipher_len] = '\0';
        *plaintext_json = (char *)plain;
        plain = NULL;
        s_rx_counter++;
    } else reset_locked();
    if (plain) mbedtls_platform_zeroize(plain, cipher_cap + 1);
    free(cipher);
    free(plain);
    if (reason) *reason = failure;
    lock_give();
    return failure ? "error_pairing_decrypt" : NULL;
}

uint32_t link_pairing_handle_client_finished(void) {
    lock_take();
    bool ok = !expired_locked()
              && s_state == PAIRING_WAIT_CLIENT_FINISHED
              && s_rx_counter == 1;
    if (ok) {
        advance_generation_locked();
        s_state = PAIRING_CONFIRM_REQUIRED;
        s_deadline_us = esp_timer_get_time() + PAIRING_CONFIRM_TIMEOUT_US;
    }
    uint32_t generation = ok ? s_generation : 0;
    lock_give();
    return generation;
}

bool link_pairing_confirmation_required(void) {
    lock_take();
    bool required = !expired_locked() && s_state == PAIRING_CONFIRM_REQUIRED;
    lock_give();
    return required;
}

bool link_pairing_arm_confirmation(uint32_t generation) {
    lock_take();
    bool ok = generation != 0 && generation == s_generation && !expired_locked()
              && s_state == PAIRING_CONFIRM_REQUIRED;
    if (ok) {
        s_confirmation_armed = true;
        s_deadline_us = esp_timer_get_time() + PAIRING_CONFIRM_TIMEOUT_US;
    }
    lock_give();
    return ok;
}

uint32_t link_pairing_confirm_active_session(void) {
    lock_take();
    bool ok = !expired_locked() && s_state == PAIRING_CONFIRM_REQUIRED
              && s_confirmation_armed;
    if (ok) {
        advance_generation_locked();
        s_state = PAIRING_READY;
        s_deadline_us = esp_timer_get_time() + PAIRING_TIMEOUT_US;
    }
    uint32_t generation = ok ? s_generation : 0;
    lock_give();
    return generation;
}

bool link_pairing_session_confirmed(void) {
    lock_take();
    bool confirmed = !expired_locked() && session_confirmed_locked();
    lock_give();
    return confirmed;
}

uint32_t link_pairing_mark_provisioning_active(void) {
    lock_take();
    if (!expired_locked() && s_state == PAIRING_READY) {
        advance_generation_locked();
        s_state = PAIRING_PROVISIONING;
        s_deadline_us = esp_timer_get_time() + PAIRING_PROVISIONING_TIMEOUT_US;
    }
    uint32_t generation = s_state == PAIRING_PROVISIONING ? s_generation : 0;
    lock_give();
    return generation;
}

bool link_pairing_provisioning_session_valid(uint32_t generation) {
    lock_take();
    bool valid = (generation == 0 || generation == s_generation)
                 && !expired_locked() && s_state == PAIRING_PROVISIONING;
    lock_give();
    return valid;
}

bool link_pairing_extend_provisioning_deadline(uint32_t generation) {
    lock_take();
    bool valid = (generation == 0 || generation == s_generation)
                 && !expired_locked() && s_state == PAIRING_PROVISIONING;
    if (valid) {
        s_deadline_us = esp_timer_get_time() + PAIRING_PROVISIONING_TIMEOUT_US;
    }
    lock_give();
    return valid;
}

bool link_pairing_commit_provisioning(uint32_t generation, bool (*commit)(void)) {
    lock_take();
    bool committed = generation != 0 && generation == s_generation
                     && !expired_locked() && s_state == PAIRING_PROVISIONING
                     && commit && commit();
    lock_give();
    return committed;
}

static char *encrypt_json_for_session(const char *plain_json, uint32_t generation,
                                      uint32_t *record_generation) {
    if (record_generation) *record_generation = 0;
    if (!plain_json) return NULL;
    lock_take();
    if ((generation != 0 && generation != s_generation)
        || expired_locked() || !session_keys_available_locked()) {
        lock_give();
        return NULL;
    }

    size_t plain_len = strlen(plain_json);
    uint8_t *cipher = malloc(plain_len);
    uint8_t tag[GCM_TAG_BYTES];
    char *envelope = NULL;
    if (cipher && aes_gcm_encrypt(s_tx_key, (const uint8_t *)plain_json,
                                  plain_len, 1, s_tx_counter, cipher, tag)) {
        envelope = make_envelope("type", s_tx_counter, cipher, plain_len, tag);
        if (envelope) {
            s_tx_counter++;
            if (record_generation) *record_generation = s_crypto_generation;
        }
    }
    free(cipher);
    lock_give();
    return envelope;
}

char *link_pairing_encrypt_json(const char *plain_json, uint32_t generation,
                                uint32_t *record_generation) {
    return encrypt_json_for_session(plain_json, generation, record_generation);
}

// Apps read only type and status, so versions that predate sdk_token ignore it.
static char *status_plain_json(const char *status) {
    cJSON *plain = cJSON_CreateObject();
    if (!plain) return NULL;
    cJSON_AddStringToObject(plain, "type", "status");
    cJSON_AddStringToObject(plain, "status", status);
    if (s_sdk_token && strcmp(status, "pairing_confirmed") == 0
        && !cJSON_AddStringToObject(plain, "sdk_token", s_sdk_token)) {
        cJSON_Delete(plain);
        return NULL;
    }
    if (s_sdk_token && strcmp(status, "pairing_confirmed") == 0) {
        ESP_LOGI(TAG, "pairing_confirmed carries SDK token %.12s", s_sdk_token);
    }
    char *plain_json = cJSON_PrintUnformatted(plain);
    cJSON_Delete(plain);
    return plain_json;
}

char *link_pairing_encrypt_status(const char *status, uint32_t generation,
                                  uint32_t *record_generation) {
    if (record_generation) *record_generation = 0;
    if (!status) return NULL;
    char *plain_json = status_plain_json(status);
    if (!plain_json) return NULL;

    char *envelope = encrypt_json_for_session(plain_json, generation, record_generation);
    free(plain_json);
    return envelope;
}

bool link_pairing_counter_selftest(void) {
    char output[32];
    int n=snprintf(output,sizeof(output),"%" PRIu64,(uint64_t)0);
    if (n!=1 || strcmp(output,"0")) return false;
    n=snprintf(output,sizeof(output),"%" PRIu64,UINT64_MAX);
    return n==20 && !strcmp(output,"18446744073709551615");
}

bool link_pairing_crypto_selftest(void) {
    const uint8_t key[32]={0},nonce[12]={0},expected[16]={0};
    const uint8_t cipher[16]={0xce,0xa7,0x40,0x3d,0x4d,0x60,0x6b,0x6e,0x07,0x4e,0xc5,0xd3,0xba,0xf3,0x9d,0x18};
    uint8_t tag[16]={0xd0,0xd1,0xc8,0xa7,0x99,0x99,0x6b,0xf0,0x26,0x5b,0x98,0xb5,0xd4,0x8a,0xb9,0x19};
    uint8_t plain[16];
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    int rc=mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,key,256);
    bool ok=false;
    if (!rc) {
        rc=mbedtls_gcm_auth_decrypt(&gcm,16,nonce,12,NULL,0,tag,16,cipher,plain);
        ok=rc==0 && memcmp(plain,expected,16)==0;
        tag[0]^=1;
        if (mbedtls_gcm_auth_decrypt(&gcm,16,nonce,12,NULL,0,tag,16,cipher,plain)==0) ok=false;
    }
    mbedtls_gcm_free(&gcm);
    mbedtls_platform_zeroize(plain,sizeof(plain));
    return ok;
}
