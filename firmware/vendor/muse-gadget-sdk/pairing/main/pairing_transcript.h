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

// Setup protocol and transcript format for official and community devices.
#define PAIRING_VERSION 5
#define PAIRING_MODEL "hatch_link"
#define PAIRING_SUITE "p256-hkdf-sha256-aes-gcm-v1"
#define PAIRING_POLICY_BUTTON "confirm_press"
#define PAIRING_POLICY_APP "confirm_app"
#define PAIRING_AUTH "fleet_ecdsa_p256_v1"
#define PAIRING_COMMUNITY_AUTH "none"
#define PAIRING_CONFIRM_TIMEOUT_SECONDS 60

typedef struct {
    const char *device_id;
    const char *node_id;
    const char *mac;
    const char *firmware_version;
    const char *mobile_pub;
    const char *device_pub;
    const char *mobile_nonce;
    const char *device_nonce;
} pairing_transcript_fields_t;

// Caller owns the allocated UTF-8 v5 transcript. Both authentication modes use
// the same protocol/domain; community requires epoch zero and has no proof.
char *pairing_transcript_build(bool community, int auth_epoch, const char *policy,
                              const pairing_transcript_fields_t *fields);
