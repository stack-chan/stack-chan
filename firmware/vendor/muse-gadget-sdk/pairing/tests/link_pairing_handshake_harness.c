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

// Compile the actual firmware source with real host Mbed TLS and cJSON.
// Only board/time/locking and the opaque hardware key handle are replaced.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS
#include "psa/crypto.h"
#define CONFIG_HOMEHUB_PAIRING_AUTH_EPOCH 1
#if TEST_PAIRING_EFUSE_AUTH
#define CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH 1
#define CONFIG_HOMEHUB_PAIRING_ECDSA_EFUSE_BLOCK 6
#endif
int test_fuse_state, test_efuse_reads;
int64_t test_now = 1;
static int test_fail_import, test_fail_sign, test_nondeterministic;
static int test_imports, test_signs;
static psa_status_t test_import_key(const psa_key_attributes_t *, const uint8_t *, size_t, psa_key_id_t *);
static psa_status_t test_sign_hash(psa_key_id_t, psa_algorithm_t, const uint8_t *, size_t, uint8_t *, size_t, size_t *);
#define psa_import_key test_import_key
#define psa_sign_hash test_sign_hash
#include "link_pairing.c"
#undef psa_import_key
#undef psa_sign_hash

#define TEST_POLICY PAIRING_POLICY_BUTTON

static psa_status_t test_import_key(const psa_key_attributes_t *a, const uint8_t *data, size_t n, psa_key_id_t *id) {
    (void)a; (void)data; (void)n;
    test_imports++;
    if (test_fail_import) return PSA_ERROR_GENERIC_ERROR;
    // A throwaway local scalar substitutes ONLY for the inaccessible eFuse key.
    uint8_t private_key[32] = {0}; private_key[31] = 1;
    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(&attr, 256);
    psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_HASH);
    psa_set_key_algorithm(&attr, PSA_ALG_DETERMINISTIC_ECDSA(PSA_ALG_SHA_256));
    return psa_import_key(&attr, private_key, sizeof(private_key), id);
}
static psa_status_t test_sign_hash(psa_key_id_t id, psa_algorithm_t alg, const uint8_t *hash, size_t hash_len, uint8_t *sig, size_t size, size_t *length) {
    test_signs++;
    if (test_fail_sign) return PSA_ERROR_GENERIC_ERROR;
    psa_status_t rc = psa_sign_hash(id, alg, hash, hash_len, sig, size, length);
    if (rc == PSA_SUCCESS && test_nondeterministic && (test_signs % 2) == 0) sig[0] ^= 1;
    return rc;
}
static void reboot(int fuse_state) {
    test_fuse_state = fuse_state;
    test_efuse_reads = test_imports = test_signs = 0;
    test_fail_import = test_fail_sign = test_nondeterministic = 0;
    test_now = 1;
    s_signer = PAIRING_SIGNER_UNRESOLVED;
    link_pairing_init("node-test", "device-test", "00:11:22:33:44:55", "0.2.1", NULL);
}
static cJSON *hello(double version, const char *auth) {
    // A valid public point generated independently of the responder key.
    mbedtls_mpi mobile_priv;
    mbedtls_ecp_point mobile_pub;
    mbedtls_mpi_init(&mobile_priv);
    mbedtls_ecp_point_init(&mobile_pub);
    assert(mbedtls_ecp_gen_keypair(&s_group, &mobile_priv, &mobile_pub, rng_cb, NULL) == 0);
    uint8_t pub[65], nonce[16]; size_t n;
    assert(mbedtls_ecp_point_write_binary(&s_group, &mobile_pub, MBEDTLS_ECP_PF_UNCOMPRESSED, &n, pub, sizeof(pub)) == 0);
    char pub_b64[96], nonce_b64[32];
    esp_fill_random(nonce, sizeof(nonce));
    assert(base64url_encode(pub, sizeof(pub), pub_b64, sizeof(pub_b64)));
    assert(base64url_encode(nonce, sizeof(nonce), nonce_b64, sizeof(nonce_b64)));
    mbedtls_mpi_free(&mobile_priv); mbedtls_ecp_point_free(&mobile_pub);
    cJSON *j=cJSON_CreateObject();
    cJSON_AddNumberToObject(j,"version",version);
    cJSON_AddStringToObject(j,"mobile_pub",pub_b64);
    cJSON_AddStringToObject(j,"mobile_nonce",nonce_b64);
    if(auth)cJSON_AddStringToObject(j,"pairing_auth",auth);
    cJSON_AddStringToObject(j,"pairing_policy",TEST_POLICY);
    return j;
}
static void reject(cJSON *j, const char *want) {
    char *reply=(char *)1;
    const char *err=link_pairing_handle_client_hello(j,&reply);
    assert(err && strcmp(err,want)==0 && !reply);
    assert(!link_pairing_session_confirmed());
    cJSON_Delete(j);
}
static void reject_auth_selection(bool community) {
    const char *auth = community ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH;
    reject(hello(5, NULL), "error_pairing_invalid_hello");
    reject(hello(5, ""), "error_pairing_invalid_hello");
    reject(hello(5, "unrecognized_auth"), "error_pairing_invalid_hello");
    reject(hello(5, community ? PAIRING_AUTH : PAIRING_COMMUNITY_AUTH),
           "error_pairing_invalid_hello");
    const char *wrong_types[] = {"null", "true", "5", "[]", "{}"};
    for (size_t i = 0; i < sizeof(wrong_types) / sizeof(wrong_types[0]); i++) {
        cJSON *j = hello(5, auth);
        cJSON_ReplaceItemInObject(j, "pairing_auth", cJSON_Parse(wrong_types[i]));
        reject(j, "error_pairing_invalid_hello");
        j = hello(5, auth);
        cJSON_ReplaceItemInObject(j, "pairing_policy", cJSON_Parse(wrong_types[i]));
        reject(j, "error_pairing_invalid_hello");
    }
    cJSON *missing_policy = hello(5, auth);
    cJSON_DeleteItemFromObject(missing_policy, "pairing_policy");
    reject(missing_policy, "error_pairing_invalid_hello");
    const char *bad_policies[] = {"", "unknown_policy",
        PAIRING_POLICY_APP};
    for (size_t i = 0; i < sizeof(bad_policies) / sizeof(bad_policies[0]); i++) {
        cJSON *j = hello(5, auth);
        cJSON_ReplaceItemInObject(j, "pairing_policy", cJSON_CreateString(bad_policies[i]));
        reject(j, "error_pairing_invalid_hello");
    }
    reject(hello(4, auth), "error_pairing_invalid_hello");
    reject(hello(5.1, auth), "error_pairing_invalid_hello");
    cJSON *j = hello(5, auth);
    cJSON_ReplaceItemInObject(j, "version", cJSON_CreateString("5"));
    reject(j, "error_pairing_invalid_hello");
    assert(test_imports == 0 && test_signs == 0 && s_state == PAIRING_IDLE);
}
static void check_device_info(bool community, int epoch) {
    cJSON *info = cJSON_CreateObject();
    link_pairing_add_device_info(info);
    assert(cJSON_GetObjectItem(info, "pairing_protocol")->valueint == 5);
    assert(cJSON_GetObjectItem(info, "pairing_transcript_version") == NULL);
    assert(cJSON_GetObjectItem(info, "pairing_required") == NULL);
    assert(cJSON_GetObjectItem(info, "cipher_suites") == NULL);
    assert(cJSON_GetObjectItem(info, "confirm_timeout_seconds") == NULL);
    {
        assert(strcmp(cJSON_GetObjectItem(info, "pairing_policy")->valuestring,
                      TEST_POLICY) == 0);
    }
    assert(cJSON_GetObjectItem(info, "pairing_auth_epoch")->valueint == epoch);
    assert(strcmp(cJSON_GetObjectItem(info, "pairing_auth")->valuestring,
                  community ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH) == 0);
    cJSON_Delete(info);
}
static void verify_official_proof(cJSON *ready) {
    uint8_t proof[PAIRING_SIG_BYTES], public_key[P256_POINT_BYTES];
    size_t proof_len, public_key_len;
    assert(base64url_decode(cJSON_GetObjectItem(ready, "device_proof")->valuestring,
                           proof, sizeof(proof), &proof_len));
    assert(proof_len == sizeof(proof));
    // The test hardware key is scalar 1, whose public key is the group generator.
    assert(mbedtls_ecp_point_write_binary(&s_group, &s_group.G,
        MBEDTLS_ECP_PF_UNCOMPRESSED, &public_key_len, public_key, sizeof(public_key)) == 0);
    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attr, PSA_KEY_TYPE_ECC_PUBLIC_KEY(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(&attr, 256);
    psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_VERIFY_HASH);
    psa_set_key_algorithm(&attr, PSA_ALG_ECDSA(PSA_ALG_SHA_256));
    psa_key_id_t key;
    assert(psa_import_key(&attr, public_key, public_key_len, &key) == PSA_SUCCESS);
    assert(psa_verify_hash(key, PSA_ALG_ECDSA(PSA_ALG_SHA_256), s_transcript_hash,
                          HASH_BYTES, proof, sizeof(proof)) == PSA_SUCCESS);
    uint8_t altered_hash[HASH_BYTES];
    memcpy(altered_hash, s_transcript_hash, sizeof(altered_hash)); altered_hash[0] ^= 1;
    assert(psa_verify_hash(key, PSA_ALG_ECDSA(PSA_ALG_SHA_256), altered_hash,
                          HASH_BYTES, proof, sizeof(proof)) != PSA_SUCCESS);
    assert(psa_destroy_key(key) == PSA_SUCCESS);
}
static void accept(bool community) {
    check_device_info(community, community ? 0 : 1);
    cJSON *j = hello(5, community ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH);
    char *reply = NULL;
    const char *err = link_pairing_handle_client_hello(j, &reply);
    if (err) fprintf(stderr, "unexpected hello error: %s (imports=%d signs=%d)\n", err, test_imports, test_signs);
    assert(!err && reply);
    cJSON *r = cJSON_Parse(reply); assert(r);
    assert(cJSON_GetObjectItem(r, "version")->valueint == 5);
    assert(cJSON_GetObjectItem(r, "transcript_version") == NULL);
    assert(cJSON_GetObjectItem(r, "selected_cipher_suite") == NULL);
    assert(strcmp(cJSON_GetObjectItem(r, "pairing_policy")->valuestring,
                  TEST_POLICY) == 0);
    assert(cJSON_GetObjectItem(r, "confirm_timeout_seconds") == NULL);
    assert(cJSON_GetObjectItem(r, "pairing_auth_epoch")->valueint == (community ? 0 : 1));
    assert(strcmp(cJSON_GetObjectItem(r, "pairing_auth")->valuestring,
                  community ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH) == 0);
    assert((cJSON_GetObjectItem(r, "device_proof") != NULL) == !community);
    if (!community) verify_official_proof(r);
    assert(s_state == PAIRING_WAIT_CLIENT_FINISHED);
    assert(!link_pairing_session_confirmed() && !link_pairing_confirmation_required());
    assert(!link_pairing_confirm_active_session());
    link_pairing_mark_provisioning_active();
    assert(!link_pairing_provisioning_session_valid(0) && s_state == PAIRING_WAIT_CLIENT_FINISHED);
    cJSON_Delete(j); cJSON_Delete(r); free(reply);
}
static cJSON *encrypted_finished(void) {
    const char *plain="{\"action\":\"pairing_client_finished\"}";
    uint8_t cipher[128], tag[16];
    assert(aes_gcm_encrypt(s_rx_key,(const uint8_t *)plain,strlen(plain),0,0,cipher,tag));
    char *envelope=make_envelope("action",0,cipher,strlen(plain),tag); assert(envelope);
    cJSON *j=cJSON_Parse(envelope); free(envelope); assert(j); return j;
}
static void finished_confirm_and_replay(void) {
    assert(!link_pairing_handle_client_finished());
    cJSON *j=encrypted_finished(); char *plain=NULL;
    assert(!link_pairing_decrypt_command(j,&plain));
    assert(plain && strcmp(plain,"{\"action\":\"pairing_client_finished\"}")==0); free(plain);
    assert(link_pairing_handle_client_finished());
    assert(link_pairing_confirmation_required() && !link_pairing_session_confirmed());
    assert(!link_pairing_confirm_active_session()); // The prompt is not emitted yet.
    assert(link_pairing_arm_confirmation(link_pairing_session_generation()));
    assert(link_pairing_confirm_active_session());
    assert(link_pairing_session_confirmed());
    // A duplicate record resets the session instead of accepting nonce reuse.
    assert(strcmp(link_pairing_decrypt_command(j,&plain),"error_pairing_decrypt")==0 && !plain);
    assert(!link_pairing_session_confirmed() && s_state==PAIRING_IDLE);
    cJSON_Delete(j);
}
static void stale_confirmation_work_cannot_affect_replacement(void) {
    accept(true);
    cJSON *finished = encrypted_finished();
    char *plain = NULL;
    assert(!link_pairing_decrypt_command(finished, &plain));
    free(plain); cJSON_Delete(finished);
    uint32_t prompt_generation = link_pairing_handle_client_finished();
    assert(prompt_generation != 0 && link_pairing_session_is_current(prompt_generation));
    assert(!link_pairing_confirm_active_session()); // Early press before the prompt.
    uint32_t record_generation = 0;
    char *status = link_pairing_encrypt_status("confirm_required", prompt_generation,
                                              &record_generation);
    assert(status); free(status);
    assert(link_pairing_arm_confirmation(prompt_generation));
    uint32_t old_generation = link_pairing_confirm_active_session();
    assert(old_generation != 0 && old_generation != prompt_generation);
    assert(!link_pairing_reset_session(prompt_generation));
    assert(!link_pairing_arm_confirmation(prompt_generation));
    assert(!link_pairing_encrypt_status("confirm_required", prompt_generation, NULL));
    assert(s_tx_counter == 1); // Rejected late prompt must not consume a nonce.
    assert(link_pairing_record_session_is_current(record_generation));
    status = link_pairing_encrypt_status("pairing_confirmed", old_generation, NULL);
    assert(status); free(status);
    assert(s_tx_counter == 2);

    // An idle timer from READY must not cancel provisioning on the same keys.
    link_pairing_mark_provisioning_active();
    assert(link_pairing_provisioning_session_valid(0));
    assert(!link_pairing_reset_session(old_generation));
    assert(!link_pairing_encrypt_status("pairing_confirm_timeout", old_generation, NULL));
    assert(link_pairing_record_session_is_current(record_generation));
    old_generation = link_pairing_session_generation();

    // A second hello on the same connection invalidates all deferred old work.
    accept(true);
    uint32_t current_generation = link_pairing_session_generation();
    assert(current_generation != 0 && current_generation != old_generation);
    assert(!link_pairing_session_is_current(old_generation));
    assert(!link_pairing_record_session_is_current(record_generation));
    assert(!link_pairing_encrypt_status("pairing_confirmed", old_generation, NULL));
    assert(s_tx_counter == 0);
    assert(!link_pairing_reset_session(old_generation));
    assert(!link_pairing_arm_confirmation(prompt_generation));
    assert(s_state == PAIRING_WAIT_CLIENT_FINISHED);

    // Explicit reset/disconnect invalidates the token before another hello.
    link_pairing_reset();
    assert(!link_pairing_session_is_current(current_generation));
    assert(!link_pairing_encrypt_status("pairing_confirmed", current_generation, NULL));
    assert(!link_pairing_reset_session(current_generation));

    // Expiry clears keys, but its own timeout can still close that connection.
    accept(true);
    current_generation = link_pairing_session_generation();
    test_now += PAIRING_CLIENT_FINISHED_TIMEOUT_US + 1;
    assert(!link_pairing_encrypt_status("pairing_confirmed", current_generation, NULL));
    assert(s_state == PAIRING_IDLE);
    assert(link_pairing_reset_session(current_generation));
    assert(!link_pairing_reset_session(current_generation));
}

static int test_commits;
static bool test_commit_result;
static bool commit_setup_marker(void) {
    test_commits++;
    return test_commit_result;
}

static uint32_t begin_provisioning(void) {
    accept(true);
    cJSON *finished = encrypted_finished();
    char *plain = NULL;
    assert(!link_pairing_decrypt_command(finished, &plain));
    free(plain); cJSON_Delete(finished);
    uint32_t generation = link_pairing_handle_client_finished();
    assert(link_pairing_arm_confirmation(generation));
    assert(link_pairing_confirm_active_session());
    generation = link_pairing_mark_provisioning_active();
    assert(generation && link_pairing_provisioning_session_valid(generation));
    return generation;
}

static void provisioning_and_scan_work_cannot_cross_sessions(void) {
    test_commits = 0;
    test_commit_result = true;
    uint32_t old_generation = begin_provisioning();
    assert(link_pairing_extend_provisioning_deadline(old_generation));
    // Wi-Fi retries stay in the same confirmed session.
    assert(link_pairing_mark_provisioning_active() == old_generation);

    accept(true); // Replacement hello has not finished or been button-confirmed.
    int64_t deadline = s_deadline_us;
    assert(!link_pairing_provisioning_session_valid(old_generation));
    assert(!link_pairing_extend_provisioning_deadline(old_generation));
    assert(s_deadline_us == deadline);
    assert(!link_pairing_commit_provisioning(old_generation, commit_setup_marker));
    assert(!link_pairing_encrypt_json("{\"type\":\"wifi_scan_result\"}",
                                      old_generation, NULL));
    assert(test_commits == 0 && s_tx_counter == 0);

    // Reproduce the confused-state case: the new request has also reached
    // PROVISIONING while the old worker is still returning from network I/O.
    uint32_t current_generation = begin_provisioning();
    assert(current_generation != old_generation);
    assert(!link_pairing_provisioning_session_valid(old_generation));
    assert(!link_pairing_commit_provisioning(old_generation, commit_setup_marker));
    assert(!link_pairing_reset_session(old_generation));
    assert(link_pairing_provisioning_session_valid(current_generation));
    assert(!link_pairing_commit_provisioning(0, commit_setup_marker));
    assert(test_commits == 0);
    test_commit_result = false;
    assert(!link_pairing_commit_provisioning(current_generation, commit_setup_marker));
    assert(test_commits == 1);
    test_commit_result = true;
    assert(link_pairing_commit_provisioning(current_generation, commit_setup_marker));
    assert(test_commits == 2);

    test_now += PAIRING_PROVISIONING_TIMEOUT_US + 1;
    assert(!link_pairing_commit_provisioning(current_generation, commit_setup_marker));
    assert(test_commits == 2);
    link_pairing_reset();
    assert(!link_pairing_commit_provisioning(current_generation, commit_setup_marker));
    assert(test_commits == 2);
}

static void pairing_confirmed_carries_sdk_token(void) {
    static const char token[] = "mgst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    char *plain = status_plain_json("pairing_confirmed");
    assert(plain && !strstr(plain, "sdk_token"));
    free(plain);

    link_pairing_init("node-test", "device-test", "00:11:22:33:44:55", "0.2.1", token);
    plain = status_plain_json("pairing_confirmed");
    cJSON *json = cJSON_Parse(plain);
    assert(json);
    assert(strcmp(cJSON_GetObjectItem(json, "type")->valuestring, "status") == 0);
    assert(strcmp(cJSON_GetObjectItem(json, "status")->valuestring, "pairing_confirmed") == 0);
    assert(strcmp(cJSON_GetObjectItem(json, "sdk_token")->valuestring, token) == 0);
    cJSON_Delete(json);
    free(plain);
    plain = status_plain_json("confirm_required");
    assert(plain && !strstr(plain, "sdk_token"));
    free(plain);
    plain = status_plain_json("auth_ok");
    assert(plain && !strstr(plain, "sdk_token"));
    free(plain);
    reboot(0);
}

static void diagnostic_reasons(void) {
    for (unsigned which=0;which<7;which++) {
        accept(true);
        cJSON *j=encrypted_finished(); char *plain=NULL;
        link_pairing_decrypt_reason_t reason=LINK_DECRYPT_OK;
        link_pairing_decrypt_reason_t expected=LINK_DECRYPT_OK;
        switch(which) {
          case 0: test_now += PAIRING_CLIENT_FINISHED_TIMEOUT_US+1; expected=LINK_DECRYPT_EXPIRED; break;
          case 1: link_pairing_reset(); expected=LINK_DECRYPT_STATE; break;
          case 2: cJSON_DeleteItemFromObject(j,"tag"); expected=LINK_DECRYPT_ENVELOPE; break;
          case 3: cJSON_ReplaceItemInObject(j,"session_id",cJSON_CreateString("public-mismatch")); expected=LINK_DECRYPT_SESSION; break;
          case 4: cJSON_ReplaceItemInObject(j,"counter",cJSON_CreateString("9")); expected=LINK_DECRYPT_COUNTER; break;
          case 5: cJSON_ReplaceItemInObject(j,"tag",cJSON_CreateString("!")); expected=LINK_DECRYPT_BASE64; break;
          case 6: s_rx_key[0]^=1; expected=LINK_DECRYPT_AEAD; break;
        }
        assert(link_pairing_decrypt_diagnostic(j,&plain,&reason));
        assert(!plain && reason==expected && s_state==PAIRING_IDLE);
        cJSON_Delete(j);
    }
    accept(true);
    cJSON *j=encrypted_finished(); char *plain=NULL;
    link_pairing_decrypt_reason_t reason=LINK_DECRYPT_AEAD;
    assert(!link_pairing_decrypt_diagnostic(j,&plain,&reason) && reason==LINK_DECRYPT_OK && plain);
    free(plain); cJSON_Delete(j); link_pairing_reset();
}
int main(void) {
    assert(psa_crypto_init()==PSA_SUCCESS);
    assert(link_pairing_counter_selftest());
    assert(link_pairing_crypto_selftest());
    reboot(0);
    diagnostic_reasons();
    reject_auth_selection(true);
    cJSON *invalid = hello(5, PAIRING_COMMUNITY_AUTH);
    uint8_t invalid_point[65]={4};char invalid_b64[96];
    assert(base64url_encode(invalid_point,sizeof(invalid_point),invalid_b64,sizeof(invalid_b64)));
    cJSON_ReplaceItemInObject(invalid,"mobile_pub",cJSON_CreateString(invalid_b64));
    reject(invalid,"error_pairing_invalid_hello");
    assert(link_pairing_plaintext_setup_blocked());
    accept(true); assert(test_imports==0 && test_signs==0);
    char previous_pub[sizeof(s_device_pub_b64)];strcpy(previous_pub,s_device_pub_b64);
    finished_confirm_and_replay();
    accept(true);assert(strcmp(previous_pub,s_device_pub_b64)!=0);
    cJSON *j=encrypted_finished();char *plain=NULL;
    assert(!link_pairing_decrypt_command(j,&plain));free(plain);cJSON_Delete(j);
    assert(link_pairing_handle_client_finished());
    test_now += PAIRING_CONFIRM_TIMEOUT_US+1;
    assert(!link_pairing_confirm_active_session() && s_state==PAIRING_IDLE);
    accept(true);
    test_now += PAIRING_CLIENT_FINISHED_TIMEOUT_US+1;
    assert(!link_pairing_handle_client_finished() && s_state==PAIRING_IDLE);
#if TEST_PAIRING_EFUSE_AUTH
    reboot(1);
    reject_auth_selection(false);
    accept(false); assert(test_imports==1 && test_signs==2); finished_confirm_and_replay();
    for(int mode=0;mode<3;mode++) {
        reboot(1); test_fail_import=mode==0;test_fail_sign=mode==1;test_nondeterministic=mode==2;
        reject(hello(5, PAIRING_AUTH),"error_pairing_unavailable");
        assert(s_signer==PAIRING_SIGNER_EFUSE && PAIRING_VERSION==5 && s_state==PAIRING_IDLE);
        reject(hello(5, PAIRING_COMMUNITY_AUTH),"error_pairing_invalid_hello");
    }
    reboot(2); check_device_info(false, 0);
    reject(hello(5, PAIRING_AUTH),"error_pairing_unavailable");
    reject(hello(5, PAIRING_COMMUNITY_AUTH),"error_pairing_invalid_hello");
    assert(test_imports==0 && test_signs==0);
#else
    reboot(1); // Attestation-off build must not read/use even a populated key.
    accept(true); assert(test_efuse_reads==0 && test_imports==0 && test_signs==0);
#endif
    reboot(0);
    stale_confirmation_work_cannot_affect_replacement();
    provisioning_and_scan_work_cannot_cross_sessions();
    pairing_confirmed_carries_sdk_token();
    printf("PASS actual pairing: eFuse=%d, explicit auth/policy agreement, encrypted finished/confirmation/replay/timeouts\n",
           TEST_PAIRING_EFUSE_AUTH);
    return 0;
}
