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

typedef enum {
    PAIRING_SIGNER_UNRESOLVED = 0,
    PAIRING_SIGNER_COMMUNITY,
    PAIRING_SIGNER_EFUSE,
    PAIRING_SIGNER_UNAVAILABLE,
} pairing_signer_t;

pairing_signer_t pairing_signer_classify(bool block_unused,
                                         bool expected_ecdsa_purpose,
                                         bool read_protected,
                                         bool write_protected,
                                         bool purpose_locked);
