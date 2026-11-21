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

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"

// sdk_token may be NULL; when set it rides on the encrypted pairing_confirmed
// status so the app can present it at device-token mint.
void link_pairing_init(const char *node_id, const char *device_id,
                       const char *mac, const char *firmware_version,
                       const char *sdk_token);
void link_pairing_reset(void);
void link_pairing_add_device_info(cJSON *root);

bool link_pairing_plaintext_setup_blocked(void);

const char *link_pairing_handle_client_hello(cJSON *root, char **response_json);
const char *link_pairing_decrypt_command(cJSON *root, char **plaintext_json);
typedef enum {
    LINK_DECRYPT_OK, LINK_DECRYPT_EXPIRED, LINK_DECRYPT_STATE,
    LINK_DECRYPT_ENVELOPE, LINK_DECRYPT_SESSION, LINK_DECRYPT_COUNTER,
    LINK_DECRYPT_MEMORY, LINK_DECRYPT_BASE64, LINK_DECRYPT_AEAD
} link_pairing_decrypt_reason_t;
const char *link_pairing_decrypt_diagnostic(cJSON *root, char **plaintext_json,
                                           link_pairing_decrypt_reason_t *reason);

// Successful confirmation transitions return an opaque nonzero session token.
uint32_t link_pairing_handle_client_finished(void);
bool link_pairing_confirmation_required(void);
// Arm physical input only after the encrypted prompt has been emitted.
bool link_pairing_arm_confirmation(uint32_t generation);
uint32_t link_pairing_confirm_active_session(void);
bool link_pairing_session_confirmed(void);
uint32_t link_pairing_mark_provisioning_active(void);
// A nonzero token binds a worker to its originating provisioning session.
// Zero queries the current state for UI/timeout bookkeeping only.
bool link_pairing_provisioning_session_valid(uint32_t generation);
bool link_pairing_extend_provisioning_deadline(uint32_t generation);
// Validate and commit the final local NVS marker under the pairing lock.
// The callback must not perform network/BLE operations or re-enter pairing.
bool link_pairing_commit_provisioning(uint32_t generation, bool (*commit)(void));

// Tokens bind deferred work to one handshake phase, including expiry cleanup.
// Finished, physical confirmation, and provisioning invalidate earlier work
// without changing encryption keys or record counters.
uint32_t link_pairing_session_generation(void);
bool link_pairing_session_is_current(uint32_t generation);
// Record tokens remain valid across phase changes, until encryption keys reset.
bool link_pairing_record_session_is_current(uint32_t generation);
bool link_pairing_reset_session(uint32_t generation);

const char *link_pairing_sign_factory_test(void);

// Returns NULL when no encrypted setup session is ready. Caller owns result.
// A nonzero generation rejects stale work atomically with encryption; zero
// retains the generic status API for the currently active session.
char *link_pairing_encrypt_status(const char *status, uint32_t generation,
                                  uint32_t *record_generation);
char *link_pairing_encrypt_json(const char *plain_json, uint32_t generation,
                                uint32_t *record_generation);

bool link_pairing_crypto_selftest(void);
bool link_pairing_counter_selftest(void);
