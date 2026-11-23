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

#include "pairing_transcript.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *pairing_transcript_build(bool community, int auth_epoch, const char *policy,
                              const pairing_transcript_fields_t *fields) {
    bool button = policy && strcmp(policy, PAIRING_POLICY_BUTTON) == 0;
    bool app = policy && strcmp(policy, PAIRING_POLICY_APP) == 0;
    if ((!button && !(community && app)) || !fields
        || (community ? auth_epoch != 0 : auth_epoch <= 0)
        || !fields->device_id || !fields->node_id || !fields->mac
        || !fields->firmware_version || !fields->mobile_pub || !fields->device_pub
        || !fields->mobile_nonce || !fields->device_nonce) {
        return NULL;
    }
    const char *format =
        "hatch-link-pairing-v%d\n"
        "version=%d\n"
        "initiator_role=mobile\n"
        "responder_role=link\n"
        "device_id=%s\n"
        "node_id=%s\n"
        "mac=%s\n"
        "model=" PAIRING_MODEL "\n"
        "firmware_version=%s\n"
        "selected_cipher_suite=" PAIRING_SUITE "\n"
        "pairing_auth=%s\n"
        "pairing_auth_epoch=%d\n"
        "pairing_policy=%s\n"
        "confirm_timeout_seconds=%d\n"
        "mobile_pub=%s\n"
        "device_pub=%s\n"
        "mobile_nonce=%s\n"
        "device_nonce=%s";
    const char *auth = community ? PAIRING_COMMUNITY_AUTH : PAIRING_AUTH;
    int n = snprintf(NULL, 0, format, PAIRING_VERSION, PAIRING_VERSION,
                     fields->device_id, fields->node_id, fields->mac,
                     fields->firmware_version, auth, auth_epoch, policy,
                     button ? PAIRING_CONFIRM_TIMEOUT_SECONDS : 0, fields->mobile_pub,
                     fields->device_pub, fields->mobile_nonce, fields->device_nonce);
    if (n <= 0) return NULL;
    char *out = malloc((size_t)n + 1);
    if (!out) return NULL;
    snprintf(out, (size_t)n + 1, format, PAIRING_VERSION, PAIRING_VERSION,
             fields->device_id, fields->node_id, fields->mac,
             fields->firmware_version, auth, auth_epoch, policy,
             button ? PAIRING_CONFIRM_TIMEOUT_SECONDS : 0, fields->mobile_pub,
             fields->device_pub, fields->mobile_nonce, fields->device_nonce);
    return out;
}
